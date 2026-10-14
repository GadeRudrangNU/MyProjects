package api

import (
	"context"
	"encoding/json"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"

	"voltbench/gateway/internal/device"
	"voltbench/gateway/internal/metrics"
)

const (
	flushTick   = 50 * time.Millisecond
	minInterval = 95 * time.Millisecond
)

type Hub struct {
	mu      sync.RWMutex
	clients map[*client]struct{}
	count   atomic.Int32
	metrics *metrics.Set
}

type pending struct {
	ts   uint64
	vals map[string]float64
}

type client struct {
	devices  map[int]bool
	mu       sync.Mutex
	pend     map[int]*pending
	lastSent map[int]time.Time
	lastVals map[int]map[string]float64
}

func NewHub(m *metrics.Set) *Hub {
	return &Hub{clients: map[*client]struct{}{}, metrics: m}
}

func (h *Hub) Publish(u device.Update) {
	if h.count.Load() == 0 {
		return
	}
	h.mu.RLock()
	defer h.mu.RUnlock()
	for c := range h.clients {
		if c.devices != nil && !c.devices[u.DeviceID] {
			continue
		}
		c.mu.Lock()
		p := c.pend[u.DeviceID]
		if p == nil {
			p = &pending{vals: map[string]float64{}}
			c.pend[u.DeviceID] = p
		}
		p.ts = u.TsMs
		for k, v := range u.Values {
			p.vals[k] = v
		}
		c.mu.Unlock()
	}
}

func (h *Hub) add(c *client) {
	h.mu.Lock()
	h.clients[c] = struct{}{}
	h.mu.Unlock()
	h.count.Add(1)
	h.metrics.WSClients.Inc()
}

func (h *Hub) remove(c *client) {
	h.mu.Lock()
	delete(h.clients, c)
	h.mu.Unlock()
	h.count.Add(-1)
	h.metrics.WSClients.Dec()
}

type wireUpdate struct {
	DeviceID int                `json:"device_id"`
	TsMs     uint64             `json:"ts_ms"`
	Values   map[string]float64 `json:"values"`
}

// Serve streams throttled, change-only updates to one websocket until it closes.
func (h *Hub) Serve(ctx context.Context, conn *websocket.Conn, devices map[int]bool) {
	c := &client{devices: devices, pend: map[int]*pending{}, lastSent: map[int]time.Time{}, lastVals: map[int]map[string]float64{}}
	h.add(c)
	defer h.remove(c)
	ctx = conn.CloseRead(ctx)
	t := time.NewTicker(flushTick)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case now := <-t.C:
			for _, msg := range c.drain(now) {
				raw, _ := json.Marshal(msg)
				wctx, cancel := context.WithTimeout(ctx, 2*time.Second)
				err := conn.Write(wctx, websocket.MessageText, raw)
				cancel()
				if err != nil {
					return
				}
			}
		}
	}
}

func (c *client) drain(now time.Time) []wireUpdate {
	c.mu.Lock()
	defer c.mu.Unlock()
	var out []wireUpdate
	for id, p := range c.pend {
		if now.Sub(c.lastSent[id]) < minInterval {
			continue
		}
		prev := c.lastVals[id]
		if prev == nil {
			prev = map[string]float64{}
			c.lastVals[id] = prev
		}
		changed := map[string]float64{}
		for k, v := range p.vals {
			if old, ok := prev[k]; !ok || old != v {
				changed[k] = v
				prev[k] = v
			}
		}
		delete(c.pend, id)
		c.lastSent[id] = now
		if len(changed) > 0 {
			out = append(out, wireUpdate{DeviceID: id, TsMs: p.ts, Values: changed})
		}
	}
	return out
}
