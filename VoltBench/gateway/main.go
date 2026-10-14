package main

import (
	"context"
	"encoding/json"
	"flag"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"time"

	"voltbench/gateway/internal/api"
	"voltbench/gateway/internal/catalog"
	"voltbench/gateway/internal/device"
	"voltbench/gateway/internal/metrics"
	"voltbench/gateway/internal/monitor"
	"voltbench/gateway/internal/store"
)

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func main() {
	addr := flag.String("addr", env("GATEWAY_ADDR", ":8080"), "http listen address")
	pgURL := flag.String("pg", env("PG_URL", "postgres://voltbench@127.0.0.1:5433/voltbench"), "postgres url")
	mongoURI := flag.String("mongo", env("MONGO_URI", "mongodb://127.0.0.1:27018"), "mongo uri")
	catPath := flag.String("catalog", env("CATALOG", "../spec/catalog.json"), "device catalog")
	manifest := flag.String("manifest", env("MANIFEST", ""), "device manifest to upsert at startup")
	runnerURL := flag.String("runner", env("RUNNER_URL", "http://127.0.0.1:8090"), "runner base url")
	labURL := flag.String("lab", env("LAB_URL", "http://127.0.0.1:9100"), "simulator lab api")
	webDir := flag.String("web", env("WEB_DIR", ""), "built dashboard directory")
	baseline := flag.Int("baseline-seconds", 30, "seconds of data used to learn the CUSUM baseline")
	flag.Parse()

	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil).WithAttrs([]slog.Attr{slog.String("svc", "gateway")})))
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()

	cat, err := catalog.Load(*catPath)
	if err != nil {
		slog.Error("load catalog", "err", err)
		os.Exit(1)
	}
	pg, err := store.OpenPG(ctx, *pgURL)
	if err != nil {
		slog.Error("connect postgres", "err", err)
		os.Exit(1)
	}
	var manifestRows []store.DeviceRow
	if *manifest != "" {
		raw, err := os.ReadFile(*manifest)
		if err != nil {
			slog.Error("read manifest", "err", err)
			os.Exit(1)
		}
		var rows []store.DeviceRow
		if err := json.Unmarshal(raw, &rows); err != nil {
			slog.Error("parse manifest", "err", err)
			os.Exit(1)
		}
		manifestRows = rows
		if err := pg.UpsertDevices(ctx, rows); err != nil {
			slog.Error("upsert devices", "err", err)
			os.Exit(1)
		}
	}
	rows := manifestRows
	if rows == nil {
		rows, err = pg.Devices(ctx)
		if err != nil {
			slog.Error("load devices", "err", err)
			os.Exit(1)
		}
	}

	m := metrics.New()
	mg, err := store.OpenMongo(ctx, *mongoURI, "voltbench", func(d time.Duration) { m.MongoBatch.Observe(d.Seconds()) })
	if err != nil {
		slog.Error("connect mongo", "err", err)
		os.Exit(1)
	}
	go mg.Run(ctx)

	hub := api.NewHub(m)
	cfg := monitor.DefaultConfig()
	cfg.BaselineSamples = *baseline * 10
	mgr := device.NewManager(cat, rows, m, mg, hub, cfg)
	go func() {
		for a := range mgr.Alerts() {
			if err := pg.InsertAlert(context.Background(), a); err != nil {
				slog.Error("insert alert", "err", err)
			}
		}
	}()
	mgr.Start(ctx)

	srv := &http.Server{
		Addr: *addr,
		Handler: (&api.Server{PG: pg, Mongo: mg, Devices: mgr, Hub: hub, Metrics: m,
			RunnerURL: *runnerURL, LabURL: *labURL, WebDir: *webDir}).Router(),
	}
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		srv.Shutdown(shutdown)
	}()
	slog.Info("gateway listening", "addr", *addr, "devices", len(rows))
	if err := srv.ListenAndServe(); err != http.ErrServerClosed {
		slog.Error("server", "err", err)
		os.Exit(1)
	}
	mg.Wait()
}
