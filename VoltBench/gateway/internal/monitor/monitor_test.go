package monitor

import (
	"math"
	"math/rand"
	"testing"
	"time"

	"voltbench/gateway/internal/catalog"
)

func feed(c *CUSUM, r *rand.Rand, n int, mean, sigma float64) int {
	first := -1
	for i := 0; i < n; i++ {
		if c.Update(mean+r.NormFloat64()*sigma) && first < 0 {
			first = i
		}
	}
	return first
}

func TestCUSUMLearnsBaseline(t *testing.T) {
	c := NewCUSUM(0.5, 5, 4, 300, 0.001)
	r := rand.New(rand.NewSource(1))
	feed(c, r, 300, 3.9, 0.005)
	mu, sigma := c.Baseline()
	if math.Abs(mu-3.9) > 0.002 || math.Abs(sigma-0.005) > 0.001 {
		t.Fatalf("baseline mu=%v sigma=%v", mu, sigma)
	}
}

func TestCUSUMQuietOnStationaryNoise(t *testing.T) {
	c := NewCUSUM(0.5, 5, 4, 300, 0.001)
	r := rand.New(rand.NewSource(2))
	feed(c, r, 300, 3.9, 0.005)
	alarms := 0
	for i := 0; i < 600; i++ {
		if c.Update(3.9 + r.NormFloat64()*0.005) {
			alarms++
		}
	}
	if alarms > 2 {
		t.Fatalf("too many false alarms: %d", alarms)
	}
}

func TestCUSUMDetectsSlowDriftBeforeRangeCheck(t *testing.T) {
	c := NewCUSUM(0.5, 5, 4, 300, 0.001)
	r := rand.New(rand.NewSource(3))
	feed(c, r, 300, 3.9, 0.005)
	rate := 0.002
	detected := -1
	for i := 0; i < 600; i++ {
		x := 3.9 + rate*float64(i)*0.1 + r.NormFloat64()*0.005
		if c.Update(x) {
			detected = i
			break
		}
	}
	if detected < 0 {
		t.Fatal("drift not detected")
	}
	if offset := rate * float64(detected) * 0.1; offset > 0.1 {
		t.Fatalf("detected only after offset %v", offset)
	}
}

func TestCUSUMIgnoresSingleSpike(t *testing.T) {
	c := NewCUSUM(0.5, 5, 4, 100, 0.001)
	r := rand.New(rand.NewSource(4))
	feed(c, r, 100, 3.9, 0.005)
	if c.Update(4.8) {
		t.Fatal("single spike should not trip cusum")
	}
}

func TestWindowSlides(t *testing.T) {
	w := NewWindow(10 * time.Second)
	t0 := time.Unix(1000, 0)
	for i := 0; i < 100; i++ {
		w.Add(t0.Add(time.Duration(i)*100*time.Millisecond), 1, 0, 0)
	}
	w.Add(t0.Add(10*time.Second), 1, 5, 0)
	if got := w.LossPct(t0.Add(10 * time.Second)); got < 4 || got > 6 {
		t.Fatalf("loss %v", got)
	}
	if got := w.LossPct(t0.Add(30 * time.Second)); got != 0 {
		t.Fatalf("expired window should be empty, got %v", got)
	}
}

func testDevice() *Device {
	dt := &catalog.DeviceType{Signals: []catalog.Signal{
		{ID: 1, Name: "v", Sigma: 0.01, Hard: [2]float64{3, 5}, Monitored: true},
	}}
	cfg := DefaultConfig()
	cfg.BaselineSamples = 50
	return NewDevice(7, dt, cfg)
}

func TestHardLimitNeedsConsecutiveSamples(t *testing.T) {
	d := testDevice()
	now := time.Unix(1000, 0)
	if a := d.Observe(now, 1, 6); len(a) != 0 {
		t.Fatal("one sample should not alert")
	}
	d.Observe(now.Add(time.Second), 1, 4)
	d.Observe(now.Add(2*time.Second), 1, 6)
	d.Observe(now.Add(2100*time.Millisecond), 1, 6)
	a := d.Observe(now.Add(2200*time.Millisecond), 1, 6)
	if len(a) != 1 || a[0].Rule != RuleHardLimit {
		t.Fatalf("alerts %+v", a)
	}
}

func TestStuckRuleFiresWhenNoiseVanishes(t *testing.T) {
	d := testDevice()
	r := rand.New(rand.NewSource(5))
	now := time.Unix(1000, 0)
	for i := 0; i < 60; i++ {
		d.Observe(now, 1, 4+r.NormFloat64()*0.01)
		now = now.Add(100 * time.Millisecond)
	}
	var got []Alert
	for i := 0; i < 30; i++ {
		got = append(got, d.Observe(now, 1, 4.0)...)
		now = now.Add(100 * time.Millisecond)
	}
	found := false
	for _, a := range got {
		found = found || a.Rule == RuleStuck
	}
	if !found {
		t.Fatalf("stuck not flagged: %+v", got)
	}
}

func TestStaleFiresOncePerOutage(t *testing.T) {
	d := testDevice()
	last := time.Unix(1000, 0)
	if d.CheckStale(last.Add(500*time.Millisecond), last) != nil {
		t.Fatal("not stale yet")
	}
	if d.CheckStale(last.Add(1500*time.Millisecond), last) == nil {
		t.Fatal("expected stale alert")
	}
	if d.CheckStale(last.Add(2*time.Second), last) != nil {
		t.Fatal("should not repeat")
	}
}
