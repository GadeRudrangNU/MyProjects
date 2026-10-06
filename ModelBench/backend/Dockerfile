FROM python:3.11-slim

# uid 1000 so the same image runs unchanged on Hugging Face Spaces
RUN useradd -m -u 1000 user
WORKDIR /app
ENV PYTHONUNBUFFERED=1 HF_HOME=/app/.cache/huggingface DATA_DIR=/app/data

COPY requirements.txt .
# CPU-only torch keeps the image ~1.5 GB smaller than the default CUDA wheel
RUN pip install --no-cache-dir torch --extra-index-url https://download.pytorch.org/whl/cpu \
 && pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY data ./data
RUN mkdir -p data/uploads .cache && chown -R user:user /app
USER user

# Bake the default model into the image so the first request isn't a cold download.
RUN python -c "from transformers import pipeline; pipeline('text-classification', model='distilbert-base-uncased-finetuned-sst-2-english')"

EXPOSE 8000
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
