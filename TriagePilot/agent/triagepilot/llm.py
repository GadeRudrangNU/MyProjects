import hashlib
import json
from pathlib import Path
from typing import TypeVar

import httpx
from pydantic import BaseModel
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from .config import Settings
from .schemas import CATEGORIES

T = TypeVar("T", bound=BaseModel)


class LlmUnavailable(Exception):
    pass


class CassetteMiss(Exception):
    pass


def _key(model: str, task: str, system: str, user: str) -> str:
    return hashlib.sha256(json.dumps([model, task, system, user]).encode()).hexdigest()


class StructuredLlm:
    """Calls a local Ollama model and checks the JSON it returns against a pydantic schema.
    In replay mode answers come from a recorded file so tests are deterministic."""

    def __init__(self, settings: Settings):
        self.s = settings
        self.cassette: dict[str, dict] = {}
        if settings.llm_mode in ("record", "replay") and Path(settings.llm_cassette).exists():
            self.cassette = json.loads(Path(settings.llm_cassette).read_text(encoding="utf-8"))
        self.client = httpx.Client(base_url=settings.ollama_url, timeout=settings.llm_timeout)

    def _save(self):
        p = Path(self.s.llm_cassette)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(self.cassette, indent=1, sort_keys=True), encoding="utf-8")

    @retry(retry=retry_if_exception_type(httpx.TransportError), stop=stop_after_attempt(3), wait=wait_exponential(min=0.5, max=4), reraise=True)
    def _call(self, system: str, user: str, schema: dict, max_tokens: int) -> str:
        r = self.client.post(
            "/api/chat",
            json={
                "model": self.s.llm_model,
                "stream": False,
                "format": schema,
                "options": {"temperature": self.s.llm_temperature, "seed": 7, "num_ctx": 4096, "num_predict": max_tokens},
                "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            },
        )
        r.raise_for_status()
        return r.json()["message"]["content"]

    def run(self, task: str, system: str, user: str, schema: type[T], max_tokens: int = 256) -> T:
        key = _key(self.s.llm_model, task, system, user)
        if self.s.llm_mode == "replay":
            if key not in self.cassette:
                raise CassetteMiss(f"no recorded answer for task {task}")
            return schema.model_validate(self.cassette[key])
        try:
            raw = self._call(system, user, schema.model_json_schema(), max_tokens)
        except (httpx.TransportError, httpx.HTTPStatusError) as exc:
            raise LlmUnavailable(str(exc)) from exc
        try:
            out = schema.model_validate(json.loads(raw))
        except json.JSONDecodeError as exc:
            raise ValueError(f"model did not return complete JSON: {exc}") from exc
        if self.s.llm_mode == "record":
            self.cassette[key] = out.model_dump()
            self._save()
        return out


CATEGORY_HELP = """Access: user accounts, passwords, licences, access cards, adding users to sites, wikis and applications.
Administrative rights: software installs, upgrades and version problems, Windows and Outlook errors.
HR Support: new starters and leavers, HR forms, leave and time cards, access to HR systems.
Hardware: monitors, laptops, phones, printers, cables, meeting room equipment, connection problems.
Internal Project: project codes, project setup, pipelines, forecast and project forms.
Miscellaneous: change requests, adding people to lists or groups, approvals, ownership changes.
Purchase: purchase orders, ordered items, receipts, requests to buy something.
Storage: shared mailboxes, shared folders, permissions on shares, mailbox size and space."""

ZERO_SHOT_SYSTEM = "You sort IT helpdesk tickets into exactly one category. Categories:\n" + CATEGORY_HELP + "\nAnswer with JSON only."


def zero_shot_prompt(text: str) -> str:
    return f"Ticket:\n{text[:1500]}\n\nPick one category from: {', '.join(CATEGORIES)}."
