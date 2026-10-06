"""RAG question answering over the complaint corpus (pgvector retrieval + cited LLM answer)."""
from __future__ import annotations

from typing import Callable

from . import db
from .embeddings import Embedder
from .grounding import check_summary
from .summarize import format_evidence

SYSTEM = (
    "You answer questions about vehicle owner complaints using ONLY the numbered complaints provided. "
    "Cite the supporting complaints after every sentence, formatted exactly like [C12345]. If the "
    "complaints do not answer the question, say so. Do not speculate about causes or recalls."
)
HUMAN = "Question: {question}\n\nComplaints:\n{evidence}\n\nAnswer:"


def build_qa_chain(model: str, base_url: str) -> Callable[[dict], str]:
    from langchain_core.output_parsers import StrOutputParser
    from langchain_core.prompts import ChatPromptTemplate
    from langchain_ollama import ChatOllama

    prompt = ChatPromptTemplate.from_messages([("system", SYSTEM), ("human", HUMAN)])
    return (prompt | ChatOllama(model=model, base_url=base_url, temperature=0) | StrOutputParser()).invoke


def ask(
    conn,
    embedder: Embedder,
    question: str,
    make: str | None = None,
    model: str | None = None,
    k: int = 8,
    llm: Callable[[dict], str] | None = None,
) -> dict:
    hits = db.search(conn, embedder.encode([question])[0], make and make.upper(), model and model.upper(), k)
    complaints = [h["complaint"] for h in hits]
    sources = [
        {"id": c.id, "date": c.date_received.isoformat(), "year": c.year, "make": c.make, "model": c.model,
         "similarity": round(h["similarity"], 3), "text": c.text[:600]}
        for h, c in zip(hits, complaints)
    ]
    if not complaints:
        return {"answer": "No matching complaints found.", "mode": "retrieval", "grounded": True, "sources": []}
    if llm:
        try:
            text = llm({"question": question, "evidence": format_evidence(complaints)}).strip()
            report = check_summary(text, {c.id: c.text for c in complaints}, "")
            return {"answer": text, "mode": "ollama", "grounded": report.ok, "issues": report.issues, "sources": sources}
        except Exception as exc:
            return {"answer": f"LLM unavailable ({exc}). Showing retrieved complaints only.",
                    "mode": "retrieval", "grounded": True, "sources": sources}
    return {"answer": "No LLM configured (WROOM_LLM=none): showing the most relevant complaints.",
            "mode": "retrieval", "grounded": True, "sources": sources}
