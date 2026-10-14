import argparse
import asyncio
import json
import logging
import sys

import uvicorn

from . import catalog
from .fleet import Fleet
from .lab import create_app


class JsonFormatter(logging.Formatter):
    def format(self, record):
        out = {"ts": self.formatTime(record), "level": record.levelname, "svc": "simulator", "msg": record.getMessage()}
        for key in ("device_id", "run_id"):
            if hasattr(record, key):
                out[key] = getattr(record, key)
        return json.dumps(out)


async def main(args):
    fleet = Fleet(catalog.load(args.catalog), args.devices, args.base_port, args.seed)
    if args.manifest:
        fleet.write_manifest(args.manifest)
    await fleet.start()
    logging.getLogger("simulator").info(f"{args.devices} devices listening from port {args.base_port + 1}")
    app = create_app(fleet, args.db_url)
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=args.lab_port, log_level="warning"))
    await server.serve()
    await fleet.stop()


def cli():
    parser = argparse.ArgumentParser(prog="simulator")
    parser.add_argument("--devices", type=int, default=30)
    parser.add_argument("--base-port", type=int, default=20000)
    parser.add_argument("--lab-port", type=int, default=9100)
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--manifest", default="data/manifest.json")
    parser.add_argument("--catalog", default=None)
    parser.add_argument("--db-url", default=None)
    args = parser.parse_args()
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    logging.basicConfig(level=logging.INFO, handlers=[handler])
    asyncio.run(main(args))


if __name__ == "__main__":
    cli()
