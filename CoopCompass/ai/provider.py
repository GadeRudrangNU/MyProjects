"""Gemini provider"""
from __future__ import annotations

import logging

from backend.app.config import settings

log = logging.getLogger("coopcompass.ai")


class AIUnavailable(Exception):
    """Raised when the LLM cannot be used (no key, local mode, quota exhausted, API error)."""


def gemini_configured() -> bool:
    return settings.ai_provider == "gemini" and bool(settings.gemini_api_key)


def generate(prompt: str, json_mode: bool = False, temperature: float = 0.3) -> str:
    if not gemini_configured():
        raise AIUnavailable("Gemini is not configured (AI_PROVIDER!=gemini or GEMINI_API_KEY missing).")
    try:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=settings.gemini_api_key)
        cfg = types.GenerateContentConfig(
            temperature=temperature,
            response_mime_type="application/json" if json_mode else "text/plain",
        )
        resp = client.models.generate_content(model=settings.gemini_model, contents=prompt, config=cfg)
        text = (resp.text or "").strip()
        if not text:
            raise AIUnavailable("Gemini returned an empty response.")
        return text
    except AIUnavailable:
        raise
    except Exception as exc:
        log.warning("Gemini call failed: %s", type(exc).__name__)
        raise AIUnavailable(f"Gemini request failed ({type(exc).__name__}).") from exc
