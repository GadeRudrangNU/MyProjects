package store

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type PG struct {
	Pool *pgxpool.Pool
}

type DeviceRow struct {
	ID               int    `json:"id"`
	Serial           string `json:"serial"`
	Type             string `json:"type"`
	ExpectedFirmware string `json:"expected_firmware"`
	Host             string `json:"host"`
	Port             int    `json:"port"`
}

func OpenPG(ctx context.Context, url string) (*PG, error) {
	var pool *pgxpool.Pool
	var err error
	for i := 0; i < 20; i++ {
		pool, err = pgxpool.New(ctx, url)
		if err == nil {
			if err = pool.Ping(ctx); err == nil {
				return &PG{Pool: pool}, nil
			}
			pool.Close()
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(500 * time.Millisecond):
		}
	}
	return nil, err
}

func (p *PG) UpsertDevices(ctx context.Context, rows []DeviceRow) error {
	for _, d := range rows {
		_, err := p.Pool.Exec(ctx, `INSERT INTO devices (id, serial, type, expected_firmware, host, port)
			VALUES ($1,$2,$3,$4,$5,$6)
			ON CONFLICT (id) DO UPDATE SET serial=$2, type=$3, expected_firmware=$4, host=$5, port=$6`,
			d.ID, d.Serial, d.Type, d.ExpectedFirmware, d.Host, d.Port)
		if err != nil {
			return err
		}
	}
	return nil
}

func (p *PG) Devices(ctx context.Context) ([]DeviceRow, error) {
	rows, err := p.Pool.Query(ctx, `SELECT id, serial, type, expected_firmware, host, port FROM devices ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []DeviceRow
	for rows.Next() {
		var d DeviceRow
		if err := rows.Scan(&d.ID, &d.Serial, &d.Type, &d.ExpectedFirmware, &d.Host, &d.Port); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// JSON runs a query that yields a single JSON value (for example via json_agg).
func (p *PG) JSON(ctx context.Context, sql string, args ...any) (json.RawMessage, error) {
	var raw []byte
	if err := p.Pool.QueryRow(ctx, sql, args...).Scan(&raw); err != nil {
		return nil, err
	}
	return raw, nil
}

type AlertRow struct {
	DeviceID int
	Rule     string
	Signal   string
	Value    float64
	Detail   string
	TS       time.Time
}

func (p *PG) InsertAlert(ctx context.Context, a AlertRow) error {
	_, err := p.Pool.Exec(ctx, `INSERT INTO alerts (device_id, rule, signal, value, detail, ts) VALUES ($1,$2,$3,$4,$5,$6)`,
		a.DeviceID, a.Rule, a.Signal, a.Value, a.Detail, a.TS)
	return err
}
