package monitor

import (
	"math"
	"time"

	"voltbench/gateway/internal/catalog"
)

const (
	RuleHardLimit = "hard_limit"
	RuleStale     = "stale_signal"
	RuleLoss      = "rolling_loss"
	RuleStuck     = "stuck_value"
	RuleDrift     = "cusum_drift"
)

type Alert struct {
	DeviceID int
	Rule     string
	Signal   string
	Value    float64
	Detail   string
	TS       time.Time
}

type Config struct {
	BaselineSamples  int
	CUSUMK           float64
	CUSUMH           float64
	Cooldown         time.Duration
	HardConsecutive  int
	StuckWindow      int
	StuckFraction    float64
	LossThresholdPct float64
	StaleAfter       time.Duration
	LossWindow       time.Duration
	ClipSigmas       float64
}

func DefaultConfig() Config {
	return Config{
		BaselineSamples:  300,
		CUSUMK:           0.75,
		CUSUMH:           10,
		Cooldown:         5 * time.Second,
		HardConsecutive:  3,
		StuckWindow:      20,
		StuckFraction:    0.1,
		LossThresholdPct: 2,
		StaleAfter:       time.Second,
		LossWindow:       10 * time.Second,
		ClipSigmas:       4,
	}
}

// CUSUM is a two-sided cumulative sum detector. It learns its baseline from the
// first BaselineSamples observations and then flags sustained shifts in the mean.
type CUSUM struct {
	K, H      float64
	Clip      float64
	baselineN int
	n         int
	mean, m2  float64
	mu, sigma float64
	floor     float64
	Sp, Sm    float64
	learned   bool
}

func NewCUSUM(k, h, clip float64, baselineN int, sigmaFloor float64) *CUSUM {
	return &CUSUM{K: k, H: h, Clip: clip, baselineN: baselineN, floor: sigmaFloor}
}

func (c *CUSUM) Learned() bool                { return c.learned }
func (c *CUSUM) Baseline() (float64, float64) { return c.mu, c.sigma }

func (c *CUSUM) Reset() { c.Sp, c.Sm = 0, 0 }

// Update feeds one sample and reports whether either side crossed the threshold.
func (c *CUSUM) Update(x float64) bool {
	if !c.learned {
		c.n++
		d := x - c.mean
		c.mean += d / float64(c.n)
		c.m2 += d * (x - c.mean)
		if c.n >= c.baselineN {
			c.mu = c.mean
			c.sigma = math.Max(math.Sqrt(c.m2/float64(c.n-1)), c.floor)
			c.learned = true
		}
		return false
	}
	dev := (x - c.mu) / c.sigma
	if dev > c.Clip {
		dev = c.Clip
	} else if dev < -c.Clip {
		dev = -c.Clip
	}
	c.Sp = math.Max(0, c.Sp+dev-c.K)
	c.Sm = math.Max(0, c.Sm-dev-c.K)
	if c.Sp > c.H || c.Sm > c.H {
		c.Reset()
		return true
	}
	return false
}

type event struct {
	at                time.Time
	frames, lost, crc int
}

// Window keeps frame, loss and CRC counters over a sliding time span.
type Window struct {
	span              time.Duration
	ev                []event
	frames, lost, crc int
}

func NewWindow(span time.Duration) *Window { return &Window{span: span} }

func (w *Window) prune(now time.Time) {
	i := 0
	for ; i < len(w.ev); i++ {
		if now.Sub(w.ev[i].at) <= w.span {
			break
		}
		w.frames -= w.ev[i].frames
		w.lost -= w.ev[i].lost
		w.crc -= w.ev[i].crc
	}
	w.ev = w.ev[i:]
}

func (w *Window) Add(now time.Time, frames, lost, crc int) {
	w.prune(now)
	w.ev = append(w.ev, event{now, frames, lost, crc})
	w.frames += frames
	w.lost += lost
	w.crc += crc
}

func (w *Window) Stats(now time.Time) (frames, lost, crc int) {
	w.prune(now)
	return w.frames, w.lost, w.crc
}

func (w *Window) LossPct(now time.Time) float64 {
	frames, lost, _ := w.Stats(now)
	if frames+lost == 0 {
		return 0
	}
	return 100 * float64(lost) / float64(frames+lost)
}

type signalState struct {
	sig       catalog.Signal
	hardCount int
	ring      []float64
	pos       int
	cusum     *CUSUM
}

// Device evaluates the real-time rules for one device.
type Device struct {
	id         int
	cfg        Config
	signals    map[int]*signalState
	lastAlert  map[string]time.Time
	suppressed time.Time
	staleFired bool
	loss       *Window
}

func NewDevice(id int, dt *catalog.DeviceType, cfg Config) *Device {
	d := &Device{id: id, cfg: cfg, signals: map[int]*signalState{}, lastAlert: map[string]time.Time{}, loss: NewWindow(cfg.LossWindow)}
	for _, s := range dt.Signals {
		if !s.Monitored {
			continue
		}
		st := &signalState{sig: s}
		if s.Sigma > 0 {
			st.cusum = NewCUSUM(cfg.CUSUMK, cfg.CUSUMH, cfg.ClipSigmas, cfg.BaselineSamples, s.Sigma*0.25)
		}
		d.signals[s.ID] = st
	}
	return d
}

// Suppress silences the rules that react to commanded changes until the given time.
func (d *Device) Suppress(until time.Time) {
	if until.After(d.suppressed) {
		d.suppressed = until
	}
	for _, st := range d.signals {
		if st.cusum != nil {
			st.cusum.Reset()
		}
		st.ring = st.ring[:0]
		st.pos = 0
	}
}

func (d *Device) allow(now time.Time, rule, signal string) bool {
	key := rule + "/" + signal
	if last, ok := d.lastAlert[key]; ok && now.Sub(last) < d.cfg.Cooldown {
		return false
	}
	d.lastAlert[key] = now
	return true
}

func (d *Device) Observe(now time.Time, signalID int, v float64) []Alert {
	st := d.signals[signalID]
	if st == nil {
		return nil
	}
	var out []Alert
	emit := func(rule, detail string) {
		if d.allow(now, rule, st.sig.Name) {
			out = append(out, Alert{DeviceID: d.id, Rule: rule, Signal: st.sig.Name, Value: v, Detail: detail, TS: now})
		}
	}
	if v < st.sig.Hard[0] || v > st.sig.Hard[1] {
		st.hardCount++
		if st.hardCount >= d.cfg.HardConsecutive {
			emit(RuleHardLimit, "outside hard limits for consecutive samples")
		}
	} else {
		st.hardCount = 0
	}
	if now.Before(d.suppressed) {
		return out
	}
	if st.cusum != nil {
		if st.cusum.Update(v) {
			emit(RuleDrift, "cusum threshold crossed")
		}
		if len(st.ring) < d.cfg.StuckWindow {
			st.ring = append(st.ring, v)
		} else {
			st.ring[st.pos] = v
			st.pos = (st.pos + 1) % d.cfg.StuckWindow
		}
		if len(st.ring) == d.cfg.StuckWindow && std(st.ring) < d.cfg.StuckFraction*st.sig.Sigma {
			emit(RuleStuck, "rolling std below expected noise floor")
		}
	}
	return out
}

func (d *Device) RecordFrame(now time.Time, lost, crc int) {
	d.loss.Add(now, 1, lost, crc)
}

func (d *Device) RecordCRC(now time.Time) {
	d.loss.Add(now, 0, 0, 1)
}

func (d *Device) LossWindowStats(now time.Time) (frames, lost, crc int) {
	return d.loss.Stats(now)
}

func (d *Device) LossPct(now time.Time) float64 { return d.loss.LossPct(now) }

func (d *Device) CheckLoss(now time.Time) *Alert {
	frames, lost, _ := d.loss.Stats(now)
	if frames+lost < 20 || now.Before(d.suppressed) {
		return nil
	}
	pct := 100 * float64(lost) / float64(frames+lost)
	if pct > d.cfg.LossThresholdPct && d.allow(now, RuleLoss, "") {
		return &Alert{DeviceID: d.id, Rule: RuleLoss, Value: pct, Detail: "frame loss above threshold over sliding window", TS: now}
	}
	return nil
}

func (d *Device) CheckStale(now, lastFrame time.Time) *Alert {
	if lastFrame.IsZero() {
		return nil
	}
	silent := now.Sub(lastFrame)
	if silent <= d.cfg.StaleAfter {
		d.staleFired = false
		return nil
	}
	if d.staleFired || now.Before(d.suppressed) {
		return nil
	}
	d.staleFired = true
	d.lastAlert[RuleStale+"/"] = now
	return &Alert{DeviceID: d.id, Rule: RuleStale, Value: silent.Seconds(), Detail: "no frames received", TS: now}
}

func std(xs []float64) float64 {
	var sum float64
	for _, x := range xs {
		sum += x
	}
	mean := sum / float64(len(xs))
	var ss float64
	for _, x := range xs {
		ss += (x - mean) * (x - mean)
	}
	return math.Sqrt(ss / float64(len(xs)))
}
