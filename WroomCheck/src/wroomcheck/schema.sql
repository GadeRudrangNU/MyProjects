CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS complaints (
    id            BIGINT PRIMARY KEY,
    make          TEXT NOT NULL,
    model         TEXT NOT NULL,
    year          INT  NOT NULL,
    component     TEXT NOT NULL,
    comp_cat      TEXT NOT NULL,
    date_received DATE NOT NULL,
    fail_date     DATE,
    crash         BOOLEAN NOT NULL DEFAULT FALSE,
    fire          BOOLEAN NOT NULL DEFAULT FALSE,
    injured       INT NOT NULL DEFAULT 0,
    deaths        INT NOT NULL DEFAULT 0,
    text          TEXT NOT NULL,
    embedding     vector(384)
);

-- detection streams complaints grouped by (make, model, comp_cat) in date order
CREATE INDEX IF NOT EXISTS complaints_group_idx
    ON complaints (make, model, comp_cat, date_received, id);

CREATE TABLE IF NOT EXISTS campaigns (
    camp_no             TEXT NOT NULL,
    make                TEXT NOT NULL,
    model               TEXT NOT NULL,
    years               INT[] NOT NULL,
    comp_cats           TEXT[] NOT NULL,
    report_date         DATE NOT NULL,
    component           TEXT,
    description         TEXT,
    consequence         TEXT,
    remedy              TEXT,
    potentially_affected INT,
    PRIMARY KEY (camp_no, make, model)
);

-- one JSON document per detection run: alerts, backtest results, metrics
CREATE TABLE IF NOT EXISTS snapshots (
    id         SERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    doc        JSONB NOT NULL
);
