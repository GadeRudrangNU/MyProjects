PY ?= python
VENV = .venv
ifeq ($(OS),Windows_NT)
  BIN = $(VENV)/Scripts
else
  BIN = $(VENV)/bin
endif

.PHONY: setup data eda train build-db pipeline api web test readme-metrics

setup:            ## create venv, install Python + Node deps
	$(PY) -m venv $(VENV)
	$(BIN)/python -m pip install -r requirements.txt
	cd frontend && npm install

data:             ## download UCI Online Retail II into data/raw
	$(BIN)/python scripts/download_data.py

eda:              ## EDA / leakage audit -> reports/eda_summary.json
	$(BIN)/python -m ml.eda

train:            ## features, model comparison, evaluation -> reports/model_metrics.json
	$(BIN)/python -m ml.train

build-db:         ## score held-out period, SHAP, aggregate, load SQLite
	$(BIN)/python -m backend.build_db

pipeline: data eda train build-db   ## everything needed before starting the app
	$(BIN)/python scripts/update_readme_metrics.py

api:              ## FastAPI on :8010 (docs at /docs)
	$(BIN)/python -m uvicorn backend.app.main:app --port 8010

web:              ## Vite dev server on :5173 (proxies /api to :8010)
	cd frontend && npm run dev

test:
	$(BIN)/python -m pytest -q
	cd frontend && npm test

readme-metrics:
	$(BIN)/python scripts/update_readme_metrics.py
