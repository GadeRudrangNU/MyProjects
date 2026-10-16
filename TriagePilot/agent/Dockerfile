FROM python:3.11-slim
WORKDIR /app
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu
COPY pyproject.toml ./agent/
RUN pip install --no-cache-dir fastapi "uvicorn[standard]" "pydantic>=2" pydantic-settings langgraph scikit-learn pandas numpy joblib \
    sentence-transformers httpx tenacity "psycopg[binary]" pgvector
COPY triagepilot ./agent/triagepilot
ENV PYTHONPATH=/app/agent PYTHONUNBUFFERED=1
WORKDIR /app/agent
CMD ["uvicorn", "triagepilot.api:app_factory", "--factory", "--host", "0.0.0.0", "--port", "8000"]
