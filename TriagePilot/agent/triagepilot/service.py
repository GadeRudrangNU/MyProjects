import logging
from concurrent.futures import ThreadPoolExecutor

from .classifier import TicketClassifier
from .config import Settings
from .embeddings import get_embedder
from .graph import Deps, build_graph, run_triage
from .kb import KnowledgeBase
from .knowledge_agent import ArticleOutcome, KnowledgeAgent, ResolvedIncident
from .llm import StructuredLlm
from .runs import RunStore
from .schemas import TriageAccepted, TriageRequest
from .snclient import ServiceNowClient
from .vectorstore import get_store

log = logging.getLogger("triagepilot")


def run_key_for(req: TriageRequest) -> str:
    return f"{req.incident_sys_id}:{req.mod_count}"


def build_deps(settings: Settings, sn=None) -> Deps:
    embedder = get_embedder(settings)
    store = get_store(settings, embedder.dim)
    sn = sn or ServiceNowClient(settings)
    return Deps(
        settings=settings,
        classifier=TicketClassifier.load(settings.classifier_path),
        embedder=embedder,
        store=store,
        kb=KnowledgeBase(store, embedder, sn),
        llm=StructuredLlm(settings),
        sn=sn,
    )


class TriageService:
    def __init__(self, deps: Deps, runs: RunStore):
        self.deps, self.runs = deps, runs
        self.graph = build_graph(deps)
        self.pool = ThreadPoolExecutor(max_workers=deps.settings.workers, thread_name_prefix="triage")
        self.knowledge = KnowledgeAgent(deps.llm, deps.kb, deps.embedder, deps.sn, deps.settings.duplicate_article_similarity)

    def submit(self, req: TriageRequest, background: bool = True) -> TriageAccepted:
        key = run_key_for(req)
        if not self.runs.claim(key, req.incident_sys_id, req.mod_count):
            existing = self.runs.get(key)
            return TriageAccepted(run_key=key, status=existing["status"] if existing else "queued", duplicate=True)
        if background:
            self.pool.submit(self.execute, req, key)
        else:
            self.execute(req, key)
        return TriageAccepted(run_key=key, status="queued")

    def execute(self, req: TriageRequest, key: str):
        self.runs.mark(key, "running")
        try:
            result = run_triage(self.graph, req, key)
            self.runs.mark(key, result.status, result.model_dump())
        except Exception as exc:
            log.exception("run %s failed", key)
            self.runs.mark(key, "failed", error=str(exc)[:300])
            self._report_failure(req, key, exc)

    def _report_failure(self, req: TriageRequest, key: str, exc: Exception):
        try:
            self.deps.sn.post_result(
                {"run_key": key, "run_sys_id": req.run_sys_id, "incident_sys_id": req.incident_sys_id, "status": "failed", "errors": [str(exc)[:300]], "confidence": 0, "latency_ms": 0, "trace": []}
            )
        except Exception:
            log.exception("could not report failure for %s", key)

    def draft_article(self, inc: ResolvedIncident) -> ArticleOutcome:
        try:
            outcome = self.knowledge.run(inc)
        except Exception as exc:
            log.exception("article draft failed for %s", inc.number)
            outcome = ArticleOutcome(status="failed", reason=str(exc)[:200])
        try:
            self.deps.sn.post_knowledge_result({"incident_sys_id": inc.incident_sys_id, **outcome.model_dump()})
        except Exception:
            log.exception("could not report article outcome for %s", inc.number)
        return outcome

    def submit_article(self, inc: ResolvedIncident):
        self.pool.submit(self.draft_article, inc)
