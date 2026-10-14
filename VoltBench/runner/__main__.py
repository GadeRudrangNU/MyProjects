import argparse
import logging
import sys
from pathlib import Path

import uvicorn

from .service import JsonFormatter, create_app, seed

LIBRARY = Path(__file__).resolve().parent / "library"


def cli():
    parser = argparse.ArgumentParser(prog="runner")
    sub = parser.add_subparsers(dest="cmd", required=True)
    serve = sub.add_parser("serve")
    serve.add_argument("--port", type=int, default=8090)
    serve.add_argument("--pg-url", default="postgresql://voltbench@127.0.0.1:5433/voltbench")
    serve.add_argument("--gateway", default="http://127.0.0.1:8080")
    seeder = sub.add_parser("seed")
    seeder.add_argument("--pg-url", default="postgresql://voltbench@127.0.0.1:5433/voltbench")
    args = parser.parse_args()

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    logging.basicConfig(level=logging.INFO, handlers=[handler])
    if args.cmd == "seed":
        seed(args.pg_url, LIBRARY)
    else:
        uvicorn.run(create_app(args.pg_url, args.gateway), host="127.0.0.1", port=args.port, log_level="warning")


if __name__ == "__main__":
    cli()
