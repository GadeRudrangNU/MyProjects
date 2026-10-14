package api

import (
	"testing"
	"time"

	"voltbench/gateway/internal/device"
	"voltbench/gateway/internal/metrics"
)

func newClient(devices map[int]bool) *client {
	return &client{devices: devices, pend: map[int]*pending{}, lastSent: map[int]time.Time{}, lastVals: map[int]map[string]float64{}}
}

func publish(h *Hub, c *client, id int, ts uint64, vals map[string]float64) {
	h.add(c)
	defer h.remove(c)
	h.Publish(device.Update{DeviceID: id, TsMs: ts, Values: vals})
}

func TestOnlyChangedSignalsAreSent(t *testing.T) {
	h := NewHub(metrics.New())
	c := newClient(nil)
	publish(h, c, 1, 100, map[string]float64{"a": 1, "b": 2})
	first := c.drain(time.Now())
	if len(first) != 1 || len(first[0].Values) != 2 {
		t.Fatalf("first drain %+v", first)
	}

	publish(h, c, 1, 200, map[string]float64{"a": 1, "b": 3})
	second := c.drain(time.Now().Add(time.Second))
	if len(second) != 1 || len(second[0].Values) != 1 || second[0].Values["b"] != 3 {
		t.Fatalf("second drain %+v", second)
	}
}

func TestUpdatesAreThrottledPerDevice(t *testing.T) {
	h := NewHub(metrics.New())
	c := newClient(nil)
	now := time.Now()
	publish(h, c, 1, 100, map[string]float64{"a": 1})
	if len(c.drain(now)) != 1 {
		t.Fatal("expected first update")
	}
	publish(h, c, 1, 150, map[string]float64{"a": 2})
	if len(c.drain(now.Add(30*time.Millisecond))) != 0 {
		t.Fatal("update inside the throttle window should be held back")
	}
	out := c.drain(now.Add(120 * time.Millisecond))
	if len(out) != 1 || out[0].Values["a"] != 2 {
		t.Fatalf("held update was lost: %+v", out)
	}
}

func TestClientsOnlyReceiveSubscribedDevices(t *testing.T) {
	h := NewHub(metrics.New())
	c := newClient(map[int]bool{2: true})
	publish(h, c, 1, 100, map[string]float64{"a": 1})
	if len(c.pend) != 0 {
		t.Fatal("unsubscribed device leaked through")
	}
	publish(h, c, 2, 100, map[string]float64{"a": 1})
	if len(c.pend) != 1 {
		t.Fatal("subscribed device missing")
	}
}

func TestParseTimeAcceptsMillisAndRFC3339(t *testing.T) {
	def := time.Unix(1, 0)
	if got, _ := parseTime("1700000000000", def); got.UnixMilli() != 1700000000000 {
		t.Fatalf("millis: %v", got)
	}
	if got, err := parseTime("2026-01-02T03:04:05Z", def); err != nil || got.Year() != 2026 {
		t.Fatalf("rfc3339: %v %v", got, err)
	}
	if got, _ := parseTime("", def); !got.Equal(def) {
		t.Fatal("empty should return default")
	}
	if _, err := parseTime("nonsense", def); err == nil {
		t.Fatal("expected an error")
	}
}
