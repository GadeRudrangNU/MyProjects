package metrics

import "github.com/prometheus/client_golang/prometheus"

type Set struct {
	Registry       *prometheus.Registry
	FramesDecoded  prometheus.Counter
	CRCErrors      prometheus.Counter
	FramesLost     prometheus.Counter
	CommandLatency prometheus.Histogram
	DevicesByState *prometheus.GaugeVec
	MongoBatch     prometheus.Histogram
	WSClients      prometheus.Gauge
	Alerts         *prometheus.CounterVec
}

func New() *Set {
	m := &Set{
		Registry:      prometheus.NewRegistry(),
		FramesDecoded: prometheus.NewCounter(prometheus.CounterOpts{Name: "frames_decoded_total", Help: "Valid frames decoded."}),
		CRCErrors:     prometheus.NewCounter(prometheus.CounterOpts{Name: "crc_errors_total", Help: "Frames rejected by CRC."}),
		FramesLost:    prometheus.NewCounter(prometheus.CounterOpts{Name: "frames_lost_total", Help: "Frames missed according to sequence numbers."}),
		CommandLatency: prometheus.NewHistogram(prometheus.HistogramOpts{
			Name: "command_latency_seconds", Help: "Command to ACK latency.",
			Buckets: []float64{.001, .002, .005, .01, .025, .05, .1, .2, .5, 1, 2},
		}),
		DevicesByState: prometheus.NewGaugeVec(prometheus.GaugeOpts{Name: "devices_by_status", Help: "Devices per status."}, []string{"status"}),
		MongoBatch: prometheus.NewHistogram(prometheus.HistogramOpts{
			Name: "mongo_batch_write_seconds", Help: "Telemetry batch insert time.",
			Buckets: []float64{.001, .005, .01, .025, .05, .1, .25, .5, 1},
		}),
		WSClients: prometheus.NewGauge(prometheus.GaugeOpts{Name: "ws_clients", Help: "Connected websocket clients."}),
		Alerts:    prometheus.NewCounterVec(prometheus.CounterOpts{Name: "alerts_total", Help: "Alerts raised by rule."}, []string{"rule"}),
	}
	m.Registry.MustRegister(m.FramesDecoded, m.CRCErrors, m.FramesLost, m.CommandLatency, m.DevicesByState, m.MongoBatch, m.WSClients, m.Alerts)
	return m
}
