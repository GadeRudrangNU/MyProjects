package device

import (
	"context"
	"encoding/binary"
	"net"
	"testing"
	"time"

	"voltbench/gateway/internal/catalog"
	"voltbench/gateway/internal/metrics"
	"voltbench/gateway/internal/monitor"
	"voltbench/gateway/internal/protocol"
	"voltbench/gateway/internal/store"
)

type sink struct{ updates []Update }

func (s *sink) Publish(u Update) { s.updates = append(s.updates, u) }

func testCatalog() *catalog.Catalog {
	return &catalog.Catalog{
		Commands: map[string]int{"GET_VERSION": 3, "SET_OUTPUT": 5, "RESET": 2, "READ_REG": 1, "SET_PUMP_RPM": 6, "SELF_TEST": 4},
		Types: map[string]*catalog.DeviceType{
			"BCM": {
				Firmware: "3.1.0", Primary: "supply_v", Commands: []string{"GET_VERSION", "SET_OUTPUT", "RESET", "READ_REG", "SET_PUMP_RPM"},
				Signals: []catalog.Signal{
					{ID: 1, Name: "supply_v", Scale: 0.001, Nominal: 13.2, Sigma: 0.02, Range: [2]float64{11.5, 14.8}, Hard: [2]float64{10.5, 15.8}, Monitored: true},
					{ID: 2, Name: "load_current_a", Scale: 0.001, Sigma: 0.02, Range: [2]float64{-0.3, 8.3}, Hard: [2]float64{-1, 9}, Monitored: true},
				},
			},
		},
	}
}

func newTestDev(t *testing.T) (*Dev, *sink) {
	t.Helper()
	s := &sink{}
	mgr := NewManager(testCatalog(), []store.DeviceRow{{ID: 7, Serial: "BCM-0007", Type: "BCM", ExpectedFirmware: "3.1.0"}}, metrics.New(), nil, s, monitor.DefaultConfig())
	d, ok := mgr.Get(7)
	if !ok {
		t.Fatal("device missing")
	}
	return d, s
}

func telemetryFrame(seq uint16, supplyRaw int16) protocol.Frame {
	payload := []byte{1}
	payload = binary.BigEndian.AppendUint16(payload, uint16(supplyRaw))
	payload = append(payload, 2)
	payload = binary.BigEndian.AppendUint16(payload, 0)
	return protocol.Frame{DeviceID: 7, Type: protocol.Telemetry, Seq: seq, TsMs: 1000, Payload: payload}
}

func TestTelemetryIsScaledAndPublished(t *testing.T) {
	d, s := newTestDev(t)
	d.handle(telemetryFrame(0, 13204), time.Now())
	if len(s.updates) != 1 {
		t.Fatalf("updates: %d", len(s.updates))
	}
	if got := s.updates[0].Values["supply_v"]; got < 13.203 || got > 13.205 {
		t.Fatalf("supply_v = %v", got)
	}
	snap := d.Snapshot(time.Now())
	if snap.Frames != 1 || snap.Values["supply_v"] == 0 {
		t.Fatalf("snapshot %+v", snap)
	}
}

func TestLossIsCountedAcrossSequenceWraparound(t *testing.T) {
	d, _ := newTestDev(t)
	now := time.Now()
	d.handle(telemetryFrame(65534, 13200), now)
	d.handle(telemetryFrame(1, 13200), now.Add(100*time.Millisecond))
	_, lost, _ := d.Counters()
	if lost != 2 {
		t.Fatalf("lost = %d, want 2", lost)
	}
}

func TestOutOfOrderFrameIsNotCountedAsLoss(t *testing.T) {
	d, _ := newTestDev(t)
	now := time.Now()
	d.handle(telemetryFrame(10, 13200), now)
	d.handle(telemetryFrame(5, 13200), now)
	if _, lost, _ := d.Counters(); lost != 0 {
		t.Fatalf("lost = %d", lost)
	}
}

func TestBootHeartbeatResetsSequenceAndRecordsFirmware(t *testing.T) {
	d, _ := newTestDev(t)
	now := time.Now()
	d.handle(telemetryFrame(500, 13200), now)
	d.handle(protocol.Frame{DeviceID: 7, Type: protocol.Heartbeat, Seq: 0, Payload: []byte{3, 1, 0, 1}}, now)
	d.handle(telemetryFrame(1, 13200), now)
	snap := d.Snapshot(now)
	if snap.Lost != 0 || snap.Boots != 1 || snap.Firmware != "3.1.0" {
		t.Fatalf("snapshot %+v", snap)
	}
}

func TestFramesFromOtherDevicesAreIgnored(t *testing.T) {
	d, s := newTestDev(t)
	f := telemetryFrame(0, 13200)
	f.DeviceID = 99
	d.handle(f, time.Now())
	if len(s.updates) != 0 {
		t.Fatal("frame for another device was accepted")
	}
}

func TestStatusReflectsLossAndSilence(t *testing.T) {
	d, _ := newTestDev(t)
	now := time.Now()
	if d.evaluate(now) != StatusOffline {
		t.Fatal("no frames yet, expected offline")
	}
	for i := 0; i < 30; i++ {
		d.handle(telemetryFrame(uint16(i), 13200), now)
	}
	if got := d.evaluate(now); got != StatusOnline {
		t.Fatalf("got %s", got)
	}
	d.handle(telemetryFrame(60, 13200), now)
	if got := d.evaluate(now); got != StatusDegraded {
		t.Fatalf("after loss got %s", got)
	}
	if got := d.evaluate(now.Add(3 * time.Second)); got != StatusOffline {
		t.Fatalf("after silence got %s", got)
	}
}

func TestCommandIsMatchedToItsAck(t *testing.T) {
	d, _ := newTestDev(t)
	server, client := net.Pipe()
	defer server.Close()
	d.conn = client

	go func() {
		var dec protocol.Decoder
		buf := make([]byte, 64)
		n, _ := server.Read(buf)
		cmd := dec.Feed(buf[:n])[0]
		payload := []byte{cmd.Payload[0]}
		payload = binary.BigEndian.AppendUint16(payload, cmd.Seq)
		payload = append(payload, 3, 1, 0)
		d.handle(protocol.Frame{DeviceID: 7, Type: protocol.Ack, Seq: 0, Payload: payload}, time.Now())
	}()

	res, err := d.SendCommand(context.Background(), "GET_VERSION", nil, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if !res.Ack || res.Data["version"] != "3.1.0" || res.LatencyMs < 0 {
		t.Fatalf("result %+v", res)
	}
}

func TestCommandTimesOutWhenDeviceIsSilent(t *testing.T) {
	d, _ := newTestDev(t)
	server, client := net.Pipe()
	defer server.Close()
	go func() {
		buf := make([]byte, 64)
		server.Read(buf)
	}()
	d.conn = client
	res, err := d.SendCommand(context.Background(), "RESET", nil, 50*time.Millisecond)
	if err != nil || !res.TimedOut || res.Ack {
		t.Fatalf("res=%+v err=%v", res, err)
	}
}

func TestCommandFailsWithoutConnection(t *testing.T) {
	d, _ := newTestDev(t)
	if _, err := d.SendCommand(context.Background(), "RESET", nil, time.Second); err != ErrNotConnected {
		t.Fatalf("err = %v", err)
	}
}

func TestArgumentEncoding(t *testing.T) {
	cat := testCatalog()
	dt := cat.Types["BCM"]
	got, err := encodeArgs(cat, dt, "SET_OUTPUT", map[string]any{"channel": float64(1), "state": "on"})
	if err != nil || len(got) != 3 || got[0] != 5 || got[1] != 1 || got[2] != 1 {
		t.Fatalf("got %v err %v", got, err)
	}
	got, _ = encodeArgs(cat, dt, "SET_PUMP_RPM", map[string]any{"rpm": float64(3000)})
	if binary.BigEndian.Uint16(got[1:]) != 3000 {
		t.Fatalf("rpm bytes %v", got)
	}
	if _, err := encodeArgs(cat, dt, "SET_OUTPUT", map[string]any{"channel": 1}); err == nil {
		t.Fatal("missing argument should fail")
	}
	if _, err := encodeArgs(cat, dt, "SELF_TEST", nil); err == nil {
		t.Fatal("command not supported by the type should fail")
	}
}
