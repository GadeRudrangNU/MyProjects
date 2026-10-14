CREATE SCHEMA IF NOT EXISTS lab;

CREATE TABLE IF NOT EXISTS devices (
    id                INTEGER PRIMARY KEY,
    serial            TEXT NOT NULL UNIQUE,
    type              TEXT NOT NULL,
    expected_firmware TEXT NOT NULL,
    host              TEXT NOT NULL DEFAULT '127.0.0.1',
    port              INTEGER NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS test_definitions (
    id         SERIAL PRIMARY KEY,
    name       TEXT NOT NULL,
    kind       TEXT NOT NULL,
    device_type TEXT NOT NULL,
    version    INTEGER NOT NULL,
    spec_yaml  TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (name, version)
);

CREATE TABLE IF NOT EXISTS test_plans (
    id   SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS test_plan_items (
    plan_id            INTEGER NOT NULL REFERENCES test_plans(id) ON DELETE CASCADE,
    test_definition_id INTEGER NOT NULL REFERENCES test_definitions(id),
    ordinal            INTEGER NOT NULL,
    PRIMARY KEY (plan_id, ordinal)
);

CREATE TABLE IF NOT EXISTS test_runs (
    id          SERIAL PRIMARY KEY,
    plan_id     INTEGER NOT NULL REFERENCES test_plans(id),
    status      TEXT NOT NULL DEFAULT 'queued',
    seed        BIGINT,
    campaign_id TEXT,
    device_ids  INTEGER[] NOT NULL DEFAULT '{}',
    started_at  TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS test_results (
    id                 BIGSERIAL PRIMARY KEY,
    run_id             INTEGER NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
    device_id          INTEGER NOT NULL REFERENCES devices(id),
    test_definition_id INTEGER NOT NULL REFERENCES test_definitions(id),
    verdict            TEXT NOT NULL CHECK (verdict IN ('PASS','FAIL','ERROR','FLAKY')),
    attempt            INTEGER NOT NULL DEFAULT 1,
    measured           JSONB NOT NULL DEFAULT '{}',
    limits             JSONB NOT NULL DEFAULT '{}',
    steps              JSONB NOT NULL DEFAULT '[]',
    message            TEXT NOT NULL DEFAULT '',
    started_at         TIMESTAMPTZ NOT NULL,
    ended_at           TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS alerts (
    id        BIGSERIAL PRIMARY KEY,
    device_id INTEGER NOT NULL,
    rule      TEXT NOT NULL,
    signal    TEXT NOT NULL DEFAULT '',
    value     DOUBLE PRECISION,
    detail    TEXT NOT NULL DEFAULT '',
    ts        TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS scorecards (
    campaign_id TEXT PRIMARY KEY,
    data        JSONB NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lab.fault_injections (
    id          BIGSERIAL PRIMARY KEY,
    campaign_id TEXT,
    device_id   INTEGER NOT NULL,
    type        TEXT NOT NULL,
    severity    DOUBLE PRECISION NOT NULL,
    start_at    TIMESTAMPTZ NOT NULL,
    end_at      TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_results_run ON test_results (run_id);
CREATE INDEX IF NOT EXISTS idx_alerts_device_ts ON alerts (device_id, ts);
CREATE INDEX IF NOT EXISTS idx_faults_campaign ON lab.fault_injections (campaign_id);
