import secrets
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Header, HTTPException, status
from fastapi.responses import JSONResponse

from .config import Settings, get_settings
from .knowledge_agent import ResolvedIncident
from .runs import RunStore
from .schemas import TriageAccepted, TriageRequest
from .service import TriageService, build_deps


def create_app(settings: Settings | None = None, service: TriageService | None = None) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if service is None:
            svc = TriageService(build_deps(settings), RunStore(settings.runs_db))
            for step in (svc.recover, svc.deps.kb.sync):
                try:
                    step()
                except Exception:
                    pass
            app.state.service = svc
        else:
            app.state.service = service
        yield

    app = FastAPI(title="TriagePilot agent", version="0.1.0", lifespan=lifespan)

    def require_token(authorization: str = Header(default="")):
        expected = f"Bearer {settings.api_token}"
        if not secrets.compare_digest(authorization, expected):
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "bad token")

    @app.get("/healthz")
    def healthz():
        return {"ok": True}

    @app.post("/v1/triage", status_code=202, response_model=TriageAccepted, dependencies=[Depends(require_token)])
    def triage(req: TriageRequest):
        return app.state.service.submit(req)

    @app.get("/v1/runs/{run_key}", dependencies=[Depends(require_token)])
    def get_run(run_key: str):
        row = app.state.service.runs.get(run_key)
        if row is None:
            return JSONResponse({"detail": "unknown run"}, status_code=404)
        return row

    @app.post("/v1/kb/sync", dependencies=[Depends(require_token)])
    def sync_kb():
        return {"articles": app.state.service.deps.kb.sync()}

    @app.post("/v1/knowledge/draft", status_code=202, dependencies=[Depends(require_token)])
    def draft_article(inc: ResolvedIncident):
        app.state.service.submit_article(inc)
        return {"status": "queued"}

    return app


def app_factory() -> FastAPI:
    return create_app()
