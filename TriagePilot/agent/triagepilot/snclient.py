import httpx
from tenacity import retry, retry_if_exception, stop_after_attempt, wait_exponential

from .config import Settings


def _retryable(exc: BaseException) -> bool:
    if isinstance(exc, httpx.TransportError):
        return True
    return isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code >= 500


class ServiceNowClient:
    """Talks to a ServiceNow instance through the Table API and the scoped REST API."""

    def __init__(self, settings: Settings, transport: httpx.BaseTransport | None = None):
        self.client = httpx.Client(
            base_url=settings.sn_url.rstrip("/"),
            auth=(settings.sn_user, settings.sn_password),
            headers={"Accept": "application/json"},
            timeout=30,
            transport=transport,
        )

    @retry(retry=retry_if_exception(_retryable), stop=stop_after_attempt(4), wait=wait_exponential(min=0.3, max=3), reraise=True)
    def _request(self, method: str, path: str, **kw) -> dict:
        r = self.client.request(method, path, **kw)
        r.raise_for_status()
        return r.json() if r.content else {}

    def table_get(self, table: str, query: str = "", fields: str = "", limit: int = 100) -> list[dict]:
        params: dict = {"sysparm_limit": limit}
        if query:
            params["sysparm_query"] = query
        if fields:
            params["sysparm_fields"] = fields
        return self._request("GET", f"/api/now/table/{table}", params=params).get("result", [])

    def table_post(self, table: str, body: dict) -> dict:
        return self._request("POST", f"/api/now/table/{table}", json=body).get("result", {})

    def post_result(self, payload: dict) -> dict:
        return self._request("POST", "/api/x_tp/triage/result", json=payload).get("result", {})

    def post_knowledge_result(self, payload: dict) -> dict:
        return self._request("POST", "/api/x_tp/triage/knowledge_result", json=payload).get("result", {})

    def published_articles(self) -> list[dict]:
        return self.table_get("kb_knowledge", "workflow_state=published", "number,short_description,text,sys_id", limit=1000)

    def create_article_draft(self, body: dict) -> dict:
        return self.table_post("kb_knowledge", {**body, "workflow_state": "draft"})
