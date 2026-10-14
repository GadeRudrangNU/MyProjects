package device

import (
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"strings"
	"sync"
	"time"

	"voltbench/gateway/internal/catalog"
	"voltbench/gateway/internal/metrics"
	"voltbench/gateway/internal/monitor"
	"voltbench/gateway/internal/protocol"
	"voltbench/gateway/internal/store"
)

const (
	StatusOnline   = "ONLINE"
	StatusDegraded = "DEGRADED"
	StatusOffline  = "OFFLINE"

	offlineAfter  = 2 * time.Second
	suppressAfter = 4 * time.Second
)

var ErrNotConnected = errors.New("device not connected")

type Update struct {
	DeviceID int
	TsMs     uint64
	Values   map[string]float64
}

type Publisher interface {
	Publish(Update)
}

type Snapshot struct {
	ID               int                `json:"id"`
	Serial           string             `json:"serial"`
	Type             string             `json:"type"`
	Status           string             `json:"status"`
	Firmware         string             `json:"firmware"`
	ExpectedFirmware string             `json:"expected_firmware"`
	LastSeenMs       int64              `json:"last_seen_ms"`
	LossPct          float64            `json:"loss_pct"`
	CRCWindow        int                `json:"crc_errors_window"`
	Boots            int                `json:"boots"`
	LastBootMs       int64              `json:"last_boot_ms"`
	Frames           uint64             `json:"frames"`
	Lost             uint64             `json:"lost"`
	CRCErrors        uint64             `json:"crc_errors"`
	Connected        bool               `json:"connected"`
	Values           map[string]float64 `json:"values"`
}

type Reply struct {
	Type uint8
	Cmd  uint8
	Data []byte
	At   time.Time
}

type CommandResult struct {
	Ack       bool           `json:"ack"`
	Nack      bool           `json:"nack"`
	TimedOut  bool           `json:"timed_out"`
	LatencyMs float64        `json:"latency_ms"`
	SentTsMs  int64          `json:"sent_ts_ms"`
	Data      map[string]any `json:"data,omitempty"`
}

type Dev struct {
	info store.DeviceRow
	dt   *catalog.DeviceType
	m    *Manager
	mon  *monitor.Device

	mu        sync.Mutex
	conn      net.Conn
	writeMu   sync.Mutex
	firmware  string
	lastFrame time.Time
	status    string
	values    map[string]float64
	frames    uint64
	lost      uint64
	crc       uint64
	boots     int
	lastBoot  time.Time
	lastSeq   uint16
	haveSeq   bool
	cmdSeq    uint16
	pending   map[uint16]chan Reply
}

type Manager struct {
	cat     *catalog.Catalog
	metrics *metrics.Set
	mongo   *store.Mongo
	pub     Publisher
	alerts  chan store.AlertRow
	devs    map[int]*Dev
	order   []int
	cfg     monitor.Config
}

func NewManager(cat *catalog.Catalog, rows []store.DeviceRow, m *metrics.Set, mg *store.Mongo, pub Publisher, cfg monitor.Config) *Manager {
	mgr := &Manager{cat: cat, metrics: m, mongo: mg, pub: pub, alerts: make(chan store.AlertRow, 4096), devs: map[int]*Dev{}, cfg: cfg}
	for _, r := range rows {
		dt := cat.Types[r.Type]
		if dt == nil {
			continue
		}
		mgr.devs[r.ID] = &Dev{
			info: r, dt: dt, m: mgr, mon: monitor.NewDevice(r.ID, dt, cfg),
			status: StatusOffline, values: map[string]float64{}, pending: map[uint16]chan Reply{},
		}
		mgr.order = append(mgr.order, r.ID)
	}
	return mgr
}

func (m *Manager) Alerts() <-chan store.AlertRow { return m.alerts }

func (m *Manager) Start(ctx context.Context) {
	for _, d := range m.devs {
		go d.run(ctx)
	}
	go m.statusLoop(ctx)
}

func (m *Manager) Get(id int) (*Dev, bool) {
	d, ok := m.devs[id]
	return d, ok
}

func (m *Manager) Snapshots() []Snapshot {
	out := make([]Snapshot, 0, len(m.order))
	now := time.Now()
	for _, id := range m.order {
		out = append(out, m.devs[id].Snapshot(now))
	}
	return out
}

func (m *Manager) raise(a monitor.Alert) {
	m.metrics.Alerts.WithLabelValues(a.Rule).Inc()
	select {
	case m.alerts <- store.AlertRow{DeviceID: a.DeviceID, Rule: a.Rule, Signal: a.Signal, Value: a.Value, Detail: a.Detail, TS: a.TS}:
	default:
		slog.Warn("alert queue full", "device_id", a.DeviceID, "rule", a.Rule)
	}
}

func (m *Manager) statusLoop(ctx context.Context) {
	t := time.NewTicker(250 * time.Millisecond)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case now := <-t.C:
			counts := map[string]int{StatusOnline: 0, StatusDegraded: 0, StatusOffline: 0}
			for _, d := range m.devs {
				counts[d.evaluate(now)]++
			}
			for s, n := range counts {
				m.metrics.DevicesByState.WithLabelValues(s).Set(float64(n))
			}
		}
	}
}

func (d *Dev) evaluate(now time.Time) string {
	d.mu.Lock()
	defer d.mu.Unlock()
	status := StatusOffline
	if !d.lastFrame.IsZero() && now.Sub(d.lastFrame) <= offlineAfter {
		status = StatusOnline
		_, _, crc := d.mon.LossWindowStats(now)
		if d.mon.LossPct(now) > d.m.cfg.LossThresholdPct || crc > 0 {
			status = StatusDegraded
		}
	}
	d.status = status
	if a := d.mon.CheckStale(now, d.lastFrame); a != nil {
		d.m.raise(*a)
	}
	if a := d.mon.CheckLoss(now); a != nil {
		d.m.raise(*a)
	}
	return status
}

func (d *Dev) Snapshot(now time.Time) Snapshot {
	d.mu.Lock()
	defer d.mu.Unlock()
	vals := make(map[string]float64, len(d.values))
	for k, v := range d.values {
		vals[k] = v
	}
	var seen int64
	if !d.lastFrame.IsZero() {
		seen = d.lastFrame.UnixMilli()
	}
	_, _, crcW := d.mon.LossWindowStats(now)
	var bootMs int64
	if !d.lastBoot.IsZero() {
		bootMs = d.lastBoot.UnixMilli()
	}
	return Snapshot{
		ID: d.info.ID, Serial: d.info.Serial, Type: d.info.Type, Status: d.status,
		Firmware: d.firmware, ExpectedFirmware: d.info.ExpectedFirmware, LastSeenMs: seen,
		LossPct: d.mon.LossPct(now), CRCWindow: crcW, Boots: d.boots, LastBootMs: bootMs, Frames: d.frames, Lost: d.lost, CRCErrors: d.crc,
		Connected: d.conn != nil, Values: vals,
	}
}

func (d *Dev) Type() *catalog.DeviceType { return d.dt }

func (d *Dev) run(ctx context.Context) {
	backoff := 100 * time.Millisecond
	addr := fmt.Sprintf("%s:%d", d.info.Host, d.info.Port)
	for ctx.Err() == nil {
		conn, err := (&net.Dialer{Timeout: 2 * time.Second}).DialContext(ctx, "tcp", addr)
		if err != nil {
			select {
			case <-ctx.Done():
				return
			case <-time.After(backoff):
			}
			if backoff < 5*time.Second {
				backoff *= 2
			}
			continue
		}
		backoff = 100 * time.Millisecond
		d.mu.Lock()
		d.conn = conn
		d.haveSeq = false
		d.mu.Unlock()
		slog.Info("device connected", "device_id", d.info.ID)
		d.read(ctx, conn)
		d.mu.Lock()
		d.conn = nil
		d.mu.Unlock()
		conn.Close()
	}
}

func (d *Dev) read(ctx context.Context, conn net.Conn) {
	go func() {
		<-ctx.Done()
		conn.Close()
	}()
	buf := make([]byte, 4096)
	var dec protocol.Decoder
	for {
		n, err := conn.Read(buf)
		if n > 0 {
			before := dec.CRCErrors
			frames := dec.Feed(buf[:n])
			now := time.Now()
			if bad := dec.CRCErrors - before; bad > 0 {
				d.m.metrics.CRCErrors.Add(float64(bad))
				d.mu.Lock()
				d.crc += bad
				for i := uint64(0); i < bad; i++ {
					d.mon.RecordCRC(now)
				}
				d.mu.Unlock()
			}
			for _, f := range frames {
				d.handle(f, now)
			}
		}
		if err != nil {
			return
		}
	}
}

func (d *Dev) handle(f protocol.Frame, now time.Time) {
	if int(f.DeviceID) != d.info.ID {
		return
	}
	d.m.metrics.FramesDecoded.Inc()

	d.mu.Lock()
	if f.Type == protocol.Heartbeat && len(f.Payload) >= 4 && f.Payload[3]&1 == 1 {
		d.haveSeq = false
		d.boots++
		d.lastBoot = now
	}
	lost := 0
	if d.haveSeq {
		gap := protocol.SeqGap(d.lastSeq, f.Seq)
		if gap >= 0 && gap < 32768 {
			lost = gap
			d.lastSeq = f.Seq
		}
	} else {
		d.lastSeq = f.Seq
		d.haveSeq = true
	}
	d.frames++
	d.lost += uint64(lost)
	d.lastFrame = now
	d.mon.RecordFrame(now, lost, 0)
	if lost > 0 {
		d.m.metrics.FramesLost.Add(float64(lost))
	}

	switch f.Type {
	case protocol.Telemetry:
		d.telemetry(f, now)
		d.mu.Unlock()
	case protocol.Heartbeat:
		if len(f.Payload) >= 3 {
			d.firmware = fmt.Sprintf("%d.%d.%d", f.Payload[0], f.Payload[1], f.Payload[2])
		}
		d.mu.Unlock()
	case protocol.Ack, protocol.Nack:
		var ch chan Reply
		var reply Reply
		if len(f.Payload) >= 3 {
			req := binary.BigEndian.Uint16(f.Payload[1:3])
			ch = d.pending[req]
			reply = Reply{Type: f.Type, Cmd: f.Payload[0], Data: append([]byte(nil), f.Payload[3:]...), At: now}
		}
		d.mu.Unlock()
		if ch != nil {
			select {
			case ch <- reply:
			default:
			}
		}
	default:
		d.mu.Unlock()
	}
}

// telemetry runs with d.mu held.
func (d *Dev) telemetry(f protocol.Frame, now time.Time) {
	ts := time.UnixMilli(int64(f.TsMs))
	vals := make(map[string]float64, len(f.Payload)/3)
	for i := 0; i+3 <= len(f.Payload); i += 3 {
		sig := d.dt.SignalByID(int(f.Payload[i]))
		if sig == nil {
			continue
		}
		raw := int16(binary.BigEndian.Uint16(f.Payload[i+1 : i+3]))
		v := float64(raw) * sig.Scale
		vals[sig.Name] = v
		d.values[sig.Name] = v
		d.m.mongo.Enqueue(store.Sample{TS: ts, Meta: store.Meta{DeviceID: d.info.ID, Signal: sig.Name}, Value: v, Seq: int(f.Seq)})
		for _, a := range d.mon.Observe(now, sig.ID, v) {
			d.m.raise(a)
		}
	}
	d.m.pub.Publish(Update{DeviceID: d.info.ID, TsMs: f.TsMs, Values: vals})
}

func (d *Dev) Counters() (frames, lost, crc uint64) {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.frames, d.lost, d.crc
}

func encodeArgs(cat *catalog.Catalog, dt *catalog.DeviceType, name string, args map[string]any) ([]byte, error) {
	id, ok := cat.Commands[name]
	if !ok || !dt.HasCommand(name) {
		return nil, fmt.Errorf("command %s is not supported by this device type", name)
	}
	out := []byte{byte(id)}
	num := func(key string) (int, error) {
		v, ok := args[key]
		if !ok {
			return 0, fmt.Errorf("missing argument %q", key)
		}
		switch t := v.(type) {
		case float64:
			return int(t), nil
		case int:
			return t, nil
		case bool:
			if t {
				return 1, nil
			}
			return 0, nil
		case string:
			switch strings.ToLower(t) {
			case "on", "true":
				return 1, nil
			case "off", "false":
				return 0, nil
			}
		}
		return 0, fmt.Errorf("argument %q must be a number or on/off", key)
	}
	switch name {
	case "READ_REG":
		r, err := num("reg")
		if err != nil {
			return nil, err
		}
		out = append(out, byte(r))
	case "SET_OUTPUT":
		ch, err := num("channel")
		if err != nil {
			return nil, err
		}
		st, err := num("state")
		if err != nil {
			return nil, err
		}
		out = append(out, byte(ch), byte(st))
	case "SET_PUMP_RPM":
		rpm, err := num("rpm")
		if err != nil {
			return nil, err
		}
		out = binary.BigEndian.AppendUint16(out, uint16(rpm))
	}
	return out, nil
}

func (d *Dev) decodeData(cmd uint8, data []byte) map[string]any {
	switch int(cmd) {
	case d.m.cat.Commands["GET_VERSION"]:
		if len(data) >= 3 {
			return map[string]any{"version": fmt.Sprintf("%d.%d.%d", data[0], data[1], data[2])}
		}
	case d.m.cat.Commands["READ_REG"]:
		if len(data) >= 2 {
			return map[string]any{"raw": int16(binary.BigEndian.Uint16(data))}
		}
	case d.m.cat.Commands["SELF_TEST"]:
		if len(data) >= 1 {
			return map[string]any{"result": data[0]}
		}
	}
	return nil
}

func (d *Dev) SendCommand(ctx context.Context, name string, args map[string]any, timeout time.Duration) (CommandResult, error) {
	payload, err := encodeArgs(d.m.cat, d.dt, name, args)
	if err != nil {
		return CommandResult{}, err
	}
	d.mu.Lock()
	conn := d.conn
	seq := d.cmdSeq
	d.cmdSeq++
	ch := make(chan Reply, 1)
	d.pending[seq] = ch
	if strings.HasPrefix(name, "SET_") || name == "RESET" {
		d.mon.Suppress(time.Now().Add(suppressAfter))
	}
	d.mu.Unlock()
	defer func() {
		d.mu.Lock()
		delete(d.pending, seq)
		d.mu.Unlock()
	}()
	if conn == nil {
		return CommandResult{}, ErrNotConnected
	}
	sent := time.Now()
	raw, err := protocol.Encode(protocol.Frame{DeviceID: uint16(d.info.ID), Type: protocol.Command, Seq: seq, TsMs: uint64(sent.UnixMilli()), Payload: payload})
	if err != nil {
		return CommandResult{}, err
	}
	d.writeMu.Lock()
	_, err = conn.Write(raw)
	d.writeMu.Unlock()
	if err != nil {
		return CommandResult{}, ErrNotConnected
	}
	res := CommandResult{SentTsMs: sent.UnixMilli()}
	select {
	case r := <-ch:
		res.LatencyMs = float64(r.At.Sub(sent).Microseconds()) / 1000
		res.Ack = r.Type == protocol.Ack
		res.Nack = r.Type == protocol.Nack
		if res.Ack {
			d.m.metrics.CommandLatency.Observe(r.At.Sub(sent).Seconds())
			res.Data = d.decodeData(r.Cmd, r.Data)
		}
	case <-time.After(timeout):
		res.TimedOut = true
	case <-ctx.Done():
		return CommandResult{}, ctx.Err()
	}
	return res, nil
}

func (m *Manager) Catalog() *catalog.Catalog { return m.cat }
