import time

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, UploadFile
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import datasets, schemas
from .config import MAX_UPLOAD_BYTES
from .db import get_db
from .evaluator import run_evaluation
from .models import MLModel, Run
from .observability import INFERENCE_LATENCY
from .predictors import get_predictor

router = APIRouter(prefix="/api")


def _run_out(run: Run) -> schemas.RunOut:
    return schemas.RunOut(
        id=run.id, model_id=run.model_id, model_name=run.model.name, dataset=run.dataset,
        status=run.status, metrics=run.metrics, error=run.error,
        created_at=run.created_at, finished_at=run.finished_at,
    )


@router.get("/models", response_model=list[schemas.ModelOut])
def list_models(db: Session = Depends(get_db)):
    return db.scalars(select(MLModel).order_by(MLModel.id)).all()


@router.post("/models", response_model=schemas.ModelOut, status_code=201)
def register_model(body: schemas.ModelCreate, db: Session = Depends(get_db)):
    model = MLModel(**body.model_dump())
    db.add(model)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, f"A model named '{body.name}' already exists")
    return model


@router.delete("/models/{model_id}", status_code=204)
def delete_model(model_id: int, db: Session = Depends(get_db)):
    model = db.get(MLModel, model_id)
    if not model:
        raise HTTPException(404, "Model not found")
    db.delete(model)
    db.commit()


@router.get("/datasets")
def list_datasets():
    return datasets.list_datasets()


@router.post("/datasets", status_code=201)
async def upload_dataset(file: UploadFile):
    raw = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "File too large (max 2 MB)")
    try:
        return datasets.save_upload(file.filename or "upload", raw.decode("utf-8"))
    except (ValueError, UnicodeDecodeError) as exc:
        raise HTTPException(422, str(exc))


@router.post("/runs", response_model=schemas.RunOut, status_code=202)
def launch_run(body: schemas.RunCreate, tasks: BackgroundTasks, db: Session = Depends(get_db)):
    if not db.get(MLModel, body.model_id):
        raise HTTPException(404, "Model not found")
    if body.dataset not in {d["name"] for d in datasets.list_datasets()}:
        raise HTTPException(404, f"Unknown dataset '{body.dataset}'")
    run = Run(model_id=body.model_id, dataset=body.dataset)
    db.add(run)
    db.commit()
    tasks.add_task(run_evaluation, run.id)
    return _run_out(run)


@router.get("/runs", response_model=list[schemas.RunOut])
def list_runs(db: Session = Depends(get_db)):
    return [_run_out(r) for r in db.scalars(select(Run).order_by(Run.id.desc())).all()]


@router.get("/runs/{run_id}", response_model=schemas.RunOut)
def get_run(run_id: int, db: Session = Depends(get_db)):
    run = db.get(Run, run_id)
    if not run:
        raise HTTPException(404, "Run not found")
    return _run_out(run)


@router.get("/compare", response_model=list[schemas.RunOut])
def compare(run_ids: list[int] = Query(...), db: Session = Depends(get_db)):
    runs = db.scalars(select(Run).where(Run.id.in_(run_ids), Run.status == "completed").order_by(Run.id)).all()
    if not runs:
        raise HTTPException(404, "No completed runs among the requested ids")
    return [_run_out(r) for r in runs]


@router.post("/predict", response_model=schemas.PredictResponse)
def predict(body: schemas.PredictRequest, db: Session = Depends(get_db)):
    model = db.get(MLModel, body.model_id)
    if not model:
        raise HTTPException(404, "Model not found")
    try:
        predictor = get_predictor(model.hf_id, model.label_map)
        start = time.perf_counter()
        result = predictor.predict([body.text])[0]
        elapsed = time.perf_counter() - start
    except Exception as exc:
        raise HTTPException(502, f"Inference failed: {exc}")
    INFERENCE_LATENCY.labels(model=model.name).observe(elapsed)
    return schemas.PredictResponse(label=result["label"], score=result["score"], latency_ms=round(elapsed * 1000, 2))
