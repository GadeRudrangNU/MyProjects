"""Command-line entry point: `wroomcheck <command>`."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .backtest import BacktestConfig
from .config import get_settings
from .detect import DetectConfig
from .embeddings import get_embedder, prepare_text
from .pipeline import analyze, build_snapshot, embed_all, sort_key, write_snapshot
from .summarize import Summarizer, build_llm_chain

DEFAULT_SNAPSHOT = Path("frontend/public/snapshot.json")


def _summarizer(kind: str, st) -> Summarizer:
    if kind == "ollama":
        return Summarizer(build_llm_chain(st.ollama_model, st.ollama_url))
    return Summarizer(None)


def _detect_cfg(args, embedder) -> DetectConfig:
    return DetectConfig(
        threshold=args.threshold if args.threshold is not None else embedder.default_threshold,
        min_count=args.min_count,
        window_days=args.window_days,
    )


def _embed_cached(complaints, embedder):
    """Embedding real data is the slow step, so keep the vectors in data/work between runs."""
    import hashlib

    import numpy as np

    key = hashlib.md5(",".join(str(c.id) for c in complaints).encode()).hexdigest()[:12]
    path = Path("data/work") / f"emb_{embedder.name}_{len(complaints)}_{key}.npy"
    if path.exists():
        print(f"  using cached embeddings {path}")
        return np.load(path)
    vecs = embed_all(complaints, embedder)
    path.parent.mkdir(parents=True, exist_ok=True)
    np.save(path, vecs)
    return vecs


def _backtest_args(args, embedder):
    """Text-relevance gating only makes sense with calibrated (neural) embeddings."""
    if embedder.name == "hashing":
        return BacktestConfig(), None
    return BacktestConfig(min_relevance=args.min_relevance), embedder


def cmd_demo(args) -> None:
    """Offline end-to-end run on synthetic data: no database, network or GPU needed."""
    from .synth import generate

    print("Generating synthetic complaints and recalls (fictional makes)...")
    complaints, campaigns = generate(args.seed)
    _run_in_memory(complaints, campaigns, args, get_embedder("hashing"),
                   {"mode": "synthetic", "embedder": "hashing", "note": "Synthetic data with fictional makes."})
    print("Run the dashboard: cd frontend && npm install && npm run dev")


def _run_in_memory(complaints, campaigns, args, embedder, meta) -> None:
    complaints.sort(key=sort_key)
    print(f"  {len(complaints):,} complaints, {len(campaigns)} recall campaigns. Embedding with {embedder.name}...")
    vecs = _embed_cached(complaints, embedder) if meta["mode"] == "nhtsa" else embed_all(complaints, embedder)
    cfg = _detect_cfg(args, embedder)
    an = analyze(zip(complaints, vecs), campaigns, cfg, *_backtest_args(args, embedder))
    by_id = {c.id: c for c in complaints}
    snap = build_snapshot(an, lambda ids: {i: by_id[i] for i in ids}, _summarizer(args.llm, get_settings()), meta)
    write_snapshot(snap, Path(args.out))
    _print_report(snap)
    print(f"\nSnapshot written to {args.out}")


def cmd_real(args) -> None:
    """Real NHTSA data, fully in memory (no Postgres). Zips must already be in --raw."""
    from .nhtsa import iter_complaints, load_campaigns

    raw = Path(args.raw)
    zips = sorted(raw.glob("*.zip"))
    cfiles = [p for p in zips if "COMPLAINTS" in p.name.upper() or "CMPL" in p.name.upper()]
    rfiles = [p for p in zips if "RCL" in p.name.upper()]
    if not cfiles or not rfiles:
        raise SystemExit(f"Need complaint and recall zips in {raw}. Run: wroomcheck download")
    makes = args.makes.split(",") if args.makes else None
    print(f"Parsing {[p.name for p in cfiles]} ...")
    complaints = list(iter_complaints(cfiles, args.year_from, args.year_to, makes, args.limit))
    campaigns = [c for f in rfiles for c in load_campaigns(f, makes)]
    _run_in_memory(complaints, campaigns, args, get_embedder(args.embedder),
                   {"mode": "nhtsa", "embedder": args.embedder,
                    "note": f"Real NHTSA complaints and recalls. Makes: {', '.join(makes) if makes else 'all'}; "
                            f"complaints received {args.year_from}-{args.year_to or 'present'}."})


def _print_report(snap: dict) -> None:
    m = snap["metrics"]
    print("\n=== Backtest ===")
    print(f"recall campaigns      : {m['campaigns_total']} ({m['campaigns_addressable']} addressable by complaints)")
    print(f"detected early        : {m['detected_early']}  -> recall {m['recall_pct_all']}% (addressable: {m['recall_pct_addressable']}%)")
    print(f"lead time (weeks)     : mean {m['lead_weeks_mean']}, median {m['lead_weeks_median']}")
    print(f"alerts                : {m['alerts_total']}  precision {m['precision_pct']}% (hit {m['alerts_hit']}, miss {m['alerts_miss']}, pending {m['alerts_pending']})")
    s = m["summaries"]
    print(f"summaries             : {s['total']} total, {s['final_grounded_pct']}% grounded, LLM hallucination rate {s['hallucination_rate_pct']}")
    print("\nthreshold sweep:")
    for row in m["sweep"]:
        print("  ", row)


def cmd_download(args) -> None:
    from .nhtsa import COMPLAINT_BUNDLES, RECALLS_URL, download

    dest = Path(args.dest)
    download(RECALLS_URL, dest / "FLAT_RCL_POST_2010.zip")
    for url in COMPLAINT_BUNDLES.values():
        download(url, dest / url.rsplit("/", 1)[1])


def cmd_init_db(args) -> None:
    from . import db

    with db.connect(get_settings().database_url) as conn:
        db.init_schema(conn)
    print("schema ready")


def cmd_ingest(args) -> None:
    from . import db
    from .nhtsa import iter_complaints, load_campaigns

    raw = Path(args.raw)
    zips = sorted(raw.glob("*.zip"))
    cfiles = [p for p in zips if "COMPLAINTS" in p.name.upper() or "CMPL" in p.name.upper()]
    rfiles = [p for p in zips if "RCL" in p.name.upper()]
    makes = args.makes.split(",") if args.makes else None
    with db.connect(get_settings().database_url) as conn:
        db.init_schema(conn)
        n = db.insert_complaints(conn, iter_complaints(cfiles, args.year_from, args.year_to, makes, args.limit))
        print(f"inserted {n:,} complaints")
        camps = [c for f in rfiles for c in load_campaigns(f, makes)]
        db.replace_campaigns(conn, camps)
        print(f"stored {len(camps):,} recall campaigns")


def cmd_embed(args) -> None:
    from . import db

    st = get_settings()
    embedder = get_embedder(st.embedder)
    with db.connect(st.database_url) as conn:
        total = 0
        while batch := db.fetch_unembedded(conn, args.batch):
            db.save_embeddings(conn, [r[0] for r in batch], embedder.encode([prepare_text(r[1]) for r in batch]))
            total += len(batch)
            print(f"\rembedded {total:,}", end="", flush=True)
        db.create_vector_index(conn)
    print("\ndone")


def cmd_detect(args) -> None:
    from . import db

    st = get_settings()
    embedder = get_embedder(st.embedder)
    cfg = _detect_cfg(args, embedder)
    with db.connect(st.database_url) as conn:
        camps = db.load_campaigns(conn)
        an = analyze(db.stream_for_detection(conn), camps, cfg, *_backtest_args(args, embedder))
        snap = build_snapshot(
            an, lambda ids: db.fetch_complaints(conn, ids), _summarizer(args.llm or st.llm, st),
            {"mode": "nhtsa", "embedder": embedder.name},
        )
        db.save_snapshot(conn, snap)
    write_snapshot(snap, Path(args.out))
    _print_report(snap)


def cmd_serve(args) -> None:
    import uvicorn

    uvicorn.run("wroomcheck.api:app", host=args.host, port=args.port, reload=False)


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(prog="wroomcheck", description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)

    def tuning(sp, out=str(DEFAULT_SNAPSHOT)):
        sp.add_argument("--threshold", type=float, default=None, help="cosine threshold for joining a cluster")
        sp.add_argument("--min-count", type=int, default=10, help="complaints in the window needed to alert")
        sp.add_argument("--window-days", type=int, default=90)
        sp.add_argument("--min-relevance", type=float, default=0.30,
                        help="min cosine between an alert's cluster and a recall's text to count as a match (MiniLM)")
        sp.add_argument("--llm", choices=["none", "ollama"], default="none")
        sp.add_argument("--out", default=out)

    sp = sub.add_parser("demo", help="offline end-to-end run on synthetic data")
    tuning(sp, out="data/work/demo_snapshot.json")  # never overwrite the real-data dashboard snapshot
    sp.add_argument("--seed", type=int, default=7)
    sp.set_defaults(fn=cmd_demo)

    sp = sub.add_parser("real", help="real NHTSA data, in memory (no Postgres needed)")
    tuning(sp)
    sp.add_argument("--raw", default="data/raw")
    sp.add_argument("--year-from", type=int, default=2018)
    sp.add_argument("--year-to", type=int, default=None)
    sp.add_argument("--makes", default=None, help="comma-separated make filter, e.g. FORD,TOYOTA")
    sp.add_argument("--limit", type=int, default=None)
    sp.add_argument("--embedder", choices=["hashing", "minilm"], default="hashing")
    sp.set_defaults(fn=cmd_real)

    sp = sub.add_parser("download", help="download NHTSA complaint and recall flat files")
    sp.add_argument("--dest", default="data/raw")
    sp.set_defaults(fn=cmd_download)

    sub.add_parser("init-db", help="create Postgres tables and the pgvector extension").set_defaults(fn=cmd_init_db)

    sp = sub.add_parser("ingest", help="parse flat files into Postgres")
    sp.add_argument("--raw", default="data/raw")
    sp.add_argument("--year-from", type=int, default=2015)
    sp.add_argument("--year-to", type=int, default=None)
    sp.add_argument("--makes", default=None, help="comma-separated make filter, e.g. FORD,TOYOTA")
    sp.add_argument("--limit", type=int, default=None)
    sp.set_defaults(fn=cmd_ingest)

    sp = sub.add_parser("embed", help="embed complaints into pgvector")
    sp.add_argument("--batch", type=int, default=512)
    sp.set_defaults(fn=cmd_embed)

    sp = sub.add_parser("detect", help="cluster, alert, backtest and summarise from Postgres")
    tuning(sp)
    sp.set_defaults(fn=cmd_detect, llm=None)

    sp = sub.add_parser("serve", help="run the FastAPI server")
    sp.add_argument("--host", default="127.0.0.1")
    sp.add_argument("--port", type=int, default=8000)
    sp.set_defaults(fn=cmd_serve)

    args = p.parse_args(argv)
    args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
