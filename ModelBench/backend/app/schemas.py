from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ModelCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    hf_id: str = Field(min_length=1, max_length=200, description="Hugging Face repo id, or keyword:baseline")
    description: str = ""
    label_map: dict[str, str] = {}


class ModelOut(ModelCreate):
    model_config = ConfigDict(from_attributes=True)
    id: int
    created_at: datetime


class RunCreate(BaseModel):
    model_id: int
    dataset: str = "sample_sentiment"


class RunOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    model_id: int
    model_name: str
    dataset: str
    status: str
    metrics: dict | None
    error: str | None
    created_at: datetime
    finished_at: datetime | None


class PredictRequest(BaseModel):
    model_id: int
    text: str = Field(min_length=1, max_length=2000)


class PredictResponse(BaseModel):
    label: str
    score: float
    latency_ms: float
