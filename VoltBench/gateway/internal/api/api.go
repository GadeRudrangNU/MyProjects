package api

import (
	"bytes"
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/coder/websocket"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/prometheus/client_golang/prometheus/promhttp"

	"voltbench/gateway/internal/device"
	"voltbench/gateway/internal/metrics"
	"voltbench/gateway/internal/store"
)

type Server struct {
	PG        *store.PG
	Mongo     *store.Mongo
	Devices   *device.Manager
	Hub       *Hub
	Metrics   *metrics.Set
	RunnerURL string
	LabURL    string
	WebDir    string
	client    *http.Client
}

func (s *Server) Router() http.Handler {
	s.client = &http.Client{Timeout: 15 * time.Second}
	r := chi.NewRouter()
	r.Use(logRequests)
	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) { w.Write([]byte("ok")) })
	r.Get("/readyz", s.ready)
	r.Handle("/metrics", promhttp.HandlerFor(s.Metrics.Registry, promhttp.HandlerOpts{}))

	r.Route("/api", func(r chi.Router) {
		r.Get("/devices", s.listDevices)
		r.Get("/devices/{id}", s.getDevice)
		r.Get("/devices/{id}/telemetry", s.telemetry)
		r.Post("/devices/{id}/commands", s.command)
		r.Get("/catalog", s.catalog)

		r.Get("/test-definitions", s.listDefinitions)
		r.Post("/test-definitions", s.createDefinition)
		r.Get("/test-definitions/{id}", s.getDefinition)
		r.Get("/test-plans", s.listPlans)
		r.Get("/test-runs", s.listRuns)
		r.Post("/test-runs", s.createRun)
		r.Get("/test-runs/{id}", s.getRun)
		r.Get("/test-runs/{id}/report.csv", s.reportCSV)

		r.Get("/alerts", s.alerts)
		r.Get("/scorecards", s.listScorecards)
		r.Get("/scorecards/{id}", s.getScorecard)
	})
	r.Get("/ws/telemetry", s.wsTelemetry)
	r.Get("/ws/runs/{id}", s.wsRun)

	if s.LabURL != "" {
		target, _ := url.Parse(s.LabURL)
		proxy := httputil.NewSingleHostReverseProxy(target)
		r.Handle("/lab/*", http.StripPrefix("/lab", proxy))
	}
	if s.WebDir != "" {
		r.NotFound(s.static)
	}
	return r
}

func logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		if strings.HasPrefix(r.URL.Path, "/api") && time.Since(start) > 500*time.Millisecond {
			slog.Warn("slow request", "path", r.URL.Path, "ms", time.Since(start).Milliseconds())
		}
	})
}

func (s *Server) static(w http.ResponseWriter, r *http.Request) {
	path := filepath.Join(s.WebDir, filepath.Clean("/"+r.URL.Path))
	if info, err := os.Stat(path); err == nil && !info.IsDir() {
		http.ServeFile(w, r, path)
		return
	}
	http.ServeFile(w, r, filepath.Join(s.WebDir, "index.html"))
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeRaw(w http.ResponseWriter, status int, raw json.RawMessage) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	w.Write(raw)
}

func fail(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func (s *Server) ready(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	if err := s.PG.Pool.Ping(ctx); err != nil {
		fail(w, http.StatusServiceUnavailable, "postgres unavailable")
		return
	}
	w.Write([]byte("ready"))
}

func (s *Server) listDevices(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, 200, s.Devices.Snapshots())
}

func (s *Server) device(w http.ResponseWriter, r *http.Request) (*device.Dev, bool) {
	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil {
		fail(w, 400, "bad device id")
		return nil, false
	}
	d, ok := s.Devices.Get(id)
	if !ok {
		fail(w, 404, "unknown device")
		return nil, false
	}
	return d, true
}

func (s *Server) getDevice(w http.ResponseWriter, r *http.Request) {
	d, ok := s.device(w, r)
	if !ok {
		return
	}
	writeJSON(w, 200, map[string]any{"device": d.Snapshot(time.Now()), "signals": d.Type().Signals, "commands": d.Type().Commands})
}

func (s *Server) catalog(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, 200, s.Devices.Catalog())
}

func parseTime(v string, def time.Time) (time.Time, error) {
	if v == "" {
		return def, nil
	}
	if ms, err := strconv.ParseInt(v, 10, 64); err == nil {
		return time.UnixMilli(ms), nil
	}
	return time.Parse(time.RFC3339, v)
}

func (s *Server) telemetry(w http.ResponseWriter, r *http.Request) {
	d, ok := s.device(w, r)
	if !ok {
		return
	}
	q := r.URL.Query()
	now := time.Now()
	from, err := parseTime(q.Get("from"), now.Add(-time.Minute))
	if err != nil {
		fail(w, 400, "bad from")
		return
	}
	to, err := parseTime(q.Get("to"), now.Add(time.Second))
	if err != nil {
		fail(w, 400, "bad to")
		return
	}
	step, _ := strconv.ParseInt(q.Get("step"), 10, 64)
	snap := d.Snapshot(now)
	pts, err := s.Mongo.Query(r.Context(), snap.ID, q.Get("signal"), from, to, step, 50000)
	if err != nil {
		fail(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, pts)
}

func (s *Server) command(w http.ResponseWriter, r *http.Request) {
	d, ok := s.device(w, r)
	if !ok {
		return
	}
	var body struct {
		Cmd       string         `json:"cmd"`
		Args      map[string]any `json:"args"`
		TimeoutMs int            `json:"timeout_ms"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		fail(w, 400, "invalid json")
		return
	}
	timeout := time.Duration(body.TimeoutMs) * time.Millisecond
	if timeout <= 0 || timeout > 10*time.Second {
		timeout = 1500 * time.Millisecond
	}
	res, err := d.SendCommand(r.Context(), strings.ToUpper(body.Cmd), body.Args, timeout)
	switch {
	case errors.Is(err, device.ErrNotConnected):
		fail(w, http.StatusServiceUnavailable, err.Error())
	case err != nil:
		fail(w, http.StatusBadRequest, err.Error())
	default:
		writeJSON(w, 200, res)
	}
}

func (s *Server) listDefinitions(w http.ResponseWriter, r *http.Request) {
	cols := "id, name, kind, device_type, version, created_at"
	if r.URL.Query().Get("full") == "1" {
		cols += ", spec_yaml"
	}
	raw, err := s.PG.JSON(r.Context(), `SELECT coalesce(json_agg(t), '[]') FROM (SELECT `+cols+` FROM test_definitions ORDER BY name, version DESC) t`)
	s.respond(w, raw, err)
}

func (s *Server) getDefinition(w http.ResponseWriter, r *http.Request) {
	raw, err := s.PG.JSON(r.Context(), `SELECT coalesce(row_to_json(t), 'null') FROM (SELECT id, name, kind, device_type, version, spec_yaml, created_at FROM test_definitions WHERE id = $1) t`, chi.URLParam(r, "id"))
	if err == nil && string(raw) == "null" {
		fail(w, 404, "not found")
		return
	}
	s.respond(w, raw, err)
}

func (s *Server) respond(w http.ResponseWriter, raw json.RawMessage, err error) {
	if err != nil {
		fail(w, 500, err.Error())
		return
	}
	writeRaw(w, 200, raw)
}

type validation struct {
	OK         bool            `json:"ok"`
	Errors     json.RawMessage `json:"errors"`
	Name       string          `json:"name"`
	Kind       string          `json:"kind"`
	DeviceType string          `json:"device_type"`
	Version    int             `json:"version"`
}

func (s *Server) createDefinition(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(io.LimitReader(r.Body, 64<<10))
	if err != nil {
		fail(w, 400, "unreadable body")
		return
	}
	resp, err := s.client.Post(s.RunnerURL+"/validate", "text/plain", bytes.NewReader(body))
	if err != nil {
		fail(w, http.StatusBadGateway, "runner unavailable")
		return
	}
	defer resp.Body.Close()
	var v validation
	if err := json.NewDecoder(resp.Body).Decode(&v); err != nil {
		fail(w, http.StatusBadGateway, "runner returned an invalid response")
		return
	}
	if !v.OK {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]any{"ok": false, "errors": v.Errors})
		return
	}
	var id int
	err = s.PG.Pool.QueryRow(r.Context(), `INSERT INTO test_definitions (name, kind, device_type, version, spec_yaml) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
		v.Name, v.Kind, v.DeviceType, v.Version, string(body)).Scan(&id)
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		fail(w, http.StatusConflict, fmt.Sprintf("%s version %d already exists, bump the version", v.Name, v.Version))
		return
	}
	if err != nil {
		fail(w, 500, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"ok": true, "id": id, "name": v.Name, "version": v.Version})
}

func (s *Server) listPlans(w http.ResponseWriter, r *http.Request) {
	raw, err := s.PG.JSON(r.Context(), `SELECT coalesce(json_agg(t), '[]') FROM (
		SELECT p.id, p.name, coalesce((SELECT json_agg(json_build_object('id', d.id, 'name', d.name, 'kind', d.kind, 'device_type', d.device_type) ORDER BY i.ordinal)
			FROM test_plan_items i JOIN test_definitions d ON d.id = i.test_definition_id WHERE i.plan_id = p.id), '[]') AS tests
		FROM test_plans p ORDER BY p.id) t`)
	s.respond(w, raw, err)
}

func (s *Server) listRuns(w http.ResponseWriter, r *http.Request) {
	raw, err := s.PG.JSON(r.Context(), `SELECT coalesce(json_agg(t), '[]') FROM (
		SELECT r.id, r.plan_id, p.name AS plan, r.status, r.campaign_id, r.device_ids, r.started_at, r.finished_at, r.created_at,
			(SELECT coalesce(json_object_agg(verdict, n), '{}') FROM (SELECT verdict, count(*) n FROM test_results WHERE run_id = r.id GROUP BY verdict) v) AS verdicts
		FROM test_runs r JOIN test_plans p ON p.id = r.plan_id ORDER BY r.id DESC LIMIT 100) t`)
	s.respond(w, raw, err)
}

func (s *Server) createRun(w http.ResponseWriter, r *http.Request) {
	var body struct {
		PlanID     int    `json:"plan_id"`
		DeviceIDs  []int  `json:"device_ids"`
		CampaignID string `json:"campaign_id"`
		Seed       int64  `json:"seed"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.PlanID == 0 || len(body.DeviceIDs) == 0 {
		fail(w, 400, "plan_id and device_ids are required")
		return
	}
	var id int
	err := s.PG.Pool.QueryRow(r.Context(), `INSERT INTO test_runs (plan_id, device_ids, seed, campaign_id) VALUES ($1,$2,$3,NULLIF($4,'')) RETURNING id`,
		body.PlanID, body.DeviceIDs, body.Seed, body.CampaignID).Scan(&id)
	if err != nil {
		fail(w, 400, "could not create run: "+err.Error())
		return
	}
	payload, _ := json.Marshal(map[string]int{"run_id": id})
	resp, err := s.client.Post(s.RunnerURL+"/runs", "application/json", bytes.NewReader(payload))
	if err != nil || resp.StatusCode >= 300 {
		s.PG.Pool.Exec(r.Context(), `UPDATE test_runs SET status='failed', finished_at=now() WHERE id=$1`, id)
		fail(w, http.StatusBadGateway, "runner unavailable")
		return
	}
	resp.Body.Close()
	slog.Info("test run created", "run_id", id, "devices", len(body.DeviceIDs))
	writeJSON(w, http.StatusCreated, map[string]int{"run_id": id})
}

const resultCols = `res.id, res.device_id, d.serial, d.type AS device_type, td.name AS test, td.kind, res.verdict, res.attempt,
	res.measured, res.limits, res.steps, res.message, res.started_at, res.ended_at`

func (s *Server) runResults(ctx context.Context, runID string, afterID int64) (json.RawMessage, error) {
	return s.PG.JSON(ctx, `SELECT coalesce(json_agg(t ORDER BY t.id), '[]') FROM (SELECT `+resultCols+`
		FROM test_results res JOIN devices d ON d.id = res.device_id JOIN test_definitions td ON td.id = res.test_definition_id
		WHERE res.run_id = $1 AND res.id > $2) t`, runID, afterID)
}

func (s *Server) getRun(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	run, err := s.PG.JSON(r.Context(), `SELECT coalesce(row_to_json(t), 'null') FROM (
		SELECT r.id, r.plan_id, p.name AS plan, r.status, r.campaign_id, r.seed, r.device_ids, r.started_at, r.finished_at,
			(SELECT coalesce(json_agg(json_build_object('id', d.id, 'name', d.name, 'kind', d.kind, 'device_type', d.device_type) ORDER BY i.ordinal), '[]')
				FROM test_plan_items i JOIN test_definitions d ON d.id = i.test_definition_id WHERE i.plan_id = r.plan_id) AS tests
		FROM test_runs r JOIN test_plans p ON p.id = r.plan_id WHERE r.id = $1) t`, id)
	if err != nil {
		fail(w, 400, err.Error())
		return
	}
	if string(run) == "null" {
		fail(w, 404, "run not found")
		return
	}
	results, err := s.runResults(r.Context(), id, 0)
	if err != nil {
		fail(w, 500, err.Error())
		return
	}
	writeRaw(w, 200, json.RawMessage(fmt.Sprintf(`{"run":%s,"results":%s}`, run, results)))
}

func (s *Server) reportCSV(w http.ResponseWriter, r *http.Request) {
	raw, err := s.runResults(r.Context(), chi.URLParam(r, "id"), 0)
	if err != nil {
		fail(w, 400, err.Error())
		return
	}
	var rows []map[string]any
	json.Unmarshal(raw, &rows)
	w.Header().Set("Content-Type", "text/csv")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="run-%s.csv"`, chi.URLParam(r, "id")))
	cw := csv.NewWriter(w)
	cw.Write([]string{"device_id", "serial", "test", "kind", "verdict", "attempt", "message", "started_at", "ended_at", "measured", "limits"})
	for _, row := range rows {
		m, _ := json.Marshal(row["measured"])
		l, _ := json.Marshal(row["limits"])
		cw.Write([]string{fmt.Sprint(row["device_id"]), fmt.Sprint(row["serial"]), fmt.Sprint(row["test"]), fmt.Sprint(row["kind"]),
			fmt.Sprint(row["verdict"]), fmt.Sprint(row["attempt"]), fmt.Sprint(row["message"]), fmt.Sprint(row["started_at"]), fmt.Sprint(row["ended_at"]), string(m), string(l)})
	}
	cw.Flush()
}

func (s *Server) alerts(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	since, err := parseTime(q.Get("since"), time.Now().Add(-time.Hour))
	if err != nil {
		fail(w, 400, "bad since")
		return
	}
	limit, _ := strconv.Atoi(q.Get("limit"))
	if limit <= 0 || limit > 5000 {
		limit = 200
	}
	deviceID := -1
	if v := q.Get("device_id"); v != "" {
		deviceID, _ = strconv.Atoi(v)
	}
	raw, err := s.PG.JSON(r.Context(), `SELECT coalesce(json_agg(t), '[]') FROM (
		SELECT id, device_id, rule, signal, value, detail, ts FROM alerts
		WHERE ts >= $1 AND ($2 < 0 OR device_id = $2) ORDER BY ts DESC LIMIT $3) t`, since, deviceID, limit)
	s.respond(w, raw, err)
}

func (s *Server) listScorecards(w http.ResponseWriter, r *http.Request) {
	raw, err := s.PG.JSON(r.Context(), `SELECT coalesce(json_agg(t), '[]') FROM (SELECT campaign_id, created_at FROM scorecards ORDER BY created_at DESC) t`)
	s.respond(w, raw, err)
}

func (s *Server) getScorecard(w http.ResponseWriter, r *http.Request) {
	raw, err := s.PG.JSON(r.Context(), `SELECT coalesce((SELECT data FROM scorecards WHERE campaign_id = $1), 'null'::jsonb)`, chi.URLParam(r, "id"))
	if err == nil && string(raw) == "null" {
		fail(w, 404, "scorecard not found")
		return
	}
	s.respond(w, raw, err)
}

func (s *Server) wsTelemetry(w http.ResponseWriter, r *http.Request) {
	var filter map[int]bool
	if v := r.URL.Query().Get("devices"); v != "" && v != "all" {
		filter = map[int]bool{}
		for _, part := range strings.Split(v, ",") {
			if id, err := strconv.Atoi(strings.TrimSpace(part)); err == nil {
				filter[id] = true
			}
		}
	}
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
	if err != nil {
		return
	}
	defer conn.CloseNow()
	s.Hub.Serve(r.Context(), conn, filter)
}

func (s *Server) wsRun(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
	if err != nil {
		return
	}
	defer conn.CloseNow()
	ctx := conn.CloseRead(r.Context())
	var last int64
	t := time.NewTicker(500 * time.Millisecond)
	defer t.Stop()
	for {
		var status string
		if err := s.PG.Pool.QueryRow(ctx, `SELECT status FROM test_runs WHERE id = $1`, id).Scan(&status); err != nil {
			conn.Close(websocket.StatusPolicyViolation, "run not found")
			return
		}
		raw, err := s.runResults(ctx, id, last)
		if err == nil {
			var rows []struct {
				ID int64 `json:"id"`
			}
			json.Unmarshal(raw, &rows)
			for _, row := range rows {
				if row.ID > last {
					last = row.ID
				}
			}
			msg := fmt.Sprintf(`{"status":%q,"results":%s}`, status, raw)
			if err := conn.Write(ctx, websocket.MessageText, []byte(msg)); err != nil {
				return
			}
		}
		if status == "completed" || status == "failed" {
			conn.Close(websocket.StatusNormalClosure, "done")
			return
		}
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}
