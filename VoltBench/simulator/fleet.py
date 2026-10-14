import asyncio
import json
import logging
import random
import time

from . import protocol as p
from .device import CMD_RESET, TICK, Device, Fault

log = logging.getLogger("simulator")

TYPES = ["BMU", "BCM", "TCM"]


class Fleet:
    def __init__(self, catalog: dict, count: int, base_port: int, seed: int, host: str = "127.0.0.1"):
        self.catalog = catalog
        self.host = host
        self.base_port = base_port
        self.devices: dict[int, Device] = {}
        self.writers: dict[int, asyncio.StreamWriter] = {}
        self.servers: list[asyncio.AbstractServer] = []
        self._fault_id = 0
        for i in range(1, count + 1):
            dtype = TYPES[(i - 1) % len(TYPES)]
            self.devices[i] = Device(i, dtype, catalog["types"][dtype], seed * 1000 + i)

    def manifest(self) -> list[dict]:
        return [
            {
                "id": d.dev_id,
                "serial": f"{d.dtype}-{d.dev_id:04d}",
                "type": d.dtype,
                "expected_firmware": d.spec["firmware"],
                "host": self.host,
                "port": self.base_port + d.dev_id,
            }
            for d in self.devices.values()
        ]

    def write_manifest(self, path: str):
        with open(path, "w") as f:
            json.dump(self.manifest(), f, indent=2)

    def add_fault(self, device_id: int, ftype: str, severity: float, start: float, end: float) -> Fault:
        self._fault_id += 1
        fault = Fault(self._fault_id, ftype, severity, start, end)
        self.devices[device_id].faults.append(fault)
        return fault

    def clear_faults(self, device_id: int | None = None, now: float | None = None) -> list[int]:
        now = now or time.time()
        cleared = []
        for d in self.devices.values():
            if device_id is None or d.dev_id == device_id:
                for f in d.faults:
                    if f.end > now:
                        f.end = max(now, f.start)
                        cleared.append(f.id)
                d.faults = [f for f in d.faults if f.end > now - 120]
        return cleared

    async def start(self):
        for dev in self.devices.values():
            server = await asyncio.start_server(
                lambda r, w, d=dev: self._serve(d, r, w), self.host, self.base_port + dev.dev_id
            )
            self.servers.append(server)
        self.tasks = [asyncio.create_task(self._stream(d)) for d in self.devices.values()]

    async def stop(self):
        for t in self.tasks:
            t.cancel()
        for s in self.servers:
            s.close()
        for w in list(self.writers.values()):
            w.close()

    async def _stream(self, dev: Device):
        loop = asyncio.get_running_loop()
        rng = random.Random(dev.seed)
        await asyncio.sleep(rng.uniform(0, TICK))
        nxt = loop.time()
        tick = 0
        while True:
            nxt += TICK
            delay = nxt - loop.time()
            if delay < -1.0:
                nxt = loop.time()
                delay = 0
            await asyncio.sleep(max(0.0, delay))
            tick += 1
            writer = self.writers.get(dev.dev_id)
            frames = dev.stream_frames(time.time(), tick)
            if writer is None or writer.is_closing():
                continue
            if writer.transport.get_write_buffer_size() > 1_000_000:
                continue
            for f in frames:
                writer.write(f)

    async def _serve(self, dev: Device, reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        old = self.writers.get(dev.dev_id)
        if old is not None:
            old.close()
        self.writers[dev.dev_id] = writer
        decoder = p.Decoder()
        try:
            while True:
                data = await reader.read(4096)
                if not data:
                    break
                for frame in decoder.feed(data):
                    if frame.msg_type == p.COMMAND and frame.device_id == dev.dev_id:
                        asyncio.create_task(self._command(dev, frame, writer))
        except (ConnectionError, asyncio.CancelledError):
            pass
        finally:
            if self.writers.get(dev.dev_id) is writer:
                del self.writers[dev.dev_id]
            writer.close()

    async def _command(self, dev: Device, frame: p.Frame, writer: asyncio.StreamWriter):
        now = time.time()
        cmd = frame.payload[0] if frame.payload else 0
        delay = dev.command_delay(now, cmd)
        result = dev.handle_command(frame, now)
        if result is None:
            return
        await asyncio.sleep(delay)
        if not writer.is_closing():
            msg_type, payload = result
            writer.write(dev.reply_frame(msg_type, payload, time.time()))
        if cmd == CMD_RESET:
            dev.begin_reset(time.time())
