import math
import random
import struct
from dataclasses import dataclass, field

from . import protocol as p

TICK = 0.1
HEARTBEAT_EVERY = 10
REBOOT_SECONDS = 0.8
SELF_TEST_SECONDS = 0.3

LAG_TAU = {("BCM", "load_current_a"): 0.080, ("TCM", "pump_rpm"): 0.300}
OUTPUT_ON_AMPS = 5.0

CMD_READ_REG, CMD_RESET, CMD_GET_VERSION, CMD_SELF_TEST, CMD_SET_OUTPUT, CMD_SET_PUMP_RPM = 1, 2, 3, 4, 5, 6
NACK_UNSUPPORTED, NACK_BAD_ARGS = 1, 2

WRONG_FIRMWARE = (9, 9, 9)

COMMAND_NAMES = {
    CMD_READ_REG: "READ_REG",
    CMD_RESET: "RESET",
    CMD_GET_VERSION: "GET_VERSION",
    CMD_SELF_TEST: "SELF_TEST",
    CMD_SET_OUTPUT: "SET_OUTPUT",
    CMD_SET_PUMP_RPM: "SET_PUMP_RPM",
}


@dataclass
class Fault:
    id: int
    type: str
    severity: float
    start: float
    end: float
    frozen: dict | None = None

    def active(self, now: float) -> bool:
        return self.start <= now < self.end


@dataclass
class Lag:
    v0: float
    target: float
    t0: float
    tau: float

    def value(self, now: float) -> float:
        return self.target + (self.v0 - self.target) * math.exp(-max(0.0, now - self.t0) / self.tau)


@dataclass
class Device:
    dev_id: int
    dtype: str
    spec: dict
    seed: int
    firmware: tuple = field(init=False)
    seq: int = 0
    faults: list = field(default_factory=list)
    reboot_until: float = 0.0
    pending_boot: bool = False
    output_on: bool = False

    def __post_init__(self):
        self.rng = random.Random(self.seed)
        self.signals = self.spec["signals"]
        self.firmware = tuple(int(x) for x in self.spec["firmware"].split("."))
        self.offsets = {
            s["name"]: self.rng.gauss(0, s["sigma"] * 1.5) if s["sigma"] else 0.0 for s in self.signals
        }
        self.last_values: dict | None = None
        self.lags: dict[str, Lag] = {}
        self._reset_state(0.0)

    def _reset_state(self, now: float):
        self.output_on = False
        self.lags = {}
        for s in self.signals:
            tau = LAG_TAU.get((self.dtype, s["name"]))
            if tau:
                self.lags[s["name"]] = Lag(s["nominal"], s["nominal"], now, tau)

    def active(self, ftype: str, now: float) -> Fault | None:
        for f in self.faults:
            if f.type == ftype and f.active(now):
                return f
        return None

    def hung(self, now: float) -> bool:
        return self.active("hang", now) is not None

    def rebooting(self, now: float) -> bool:
        return now < self.reboot_until

    def _firmware(self, now: float) -> tuple:
        return WRONG_FIRMWARE if self.active("wrong_firmware", now) else self.firmware

    def _base(self, s: dict, now: float) -> float:
        name = s["name"]
        if name == "output_state":
            return 1.0 if self.output_on else 0.0
        lag = self.lags.get(name)
        if lag:
            return lag.value(now)
        return s["nominal"] + self.offsets[name]

    def _fresh(self, now: float) -> dict:
        out = {}
        for s in self.signals:
            v = self._base(s, now)
            if s["sigma"]:
                v += self.rng.gauss(0, s["sigma"])
            out[s["name"]] = v
        return out

    def sample(self, now: float) -> dict:
        stuck = self.active("stuck_value", now)
        if stuck:
            if stuck.frozen is None:
                stuck.frozen = dict(self.last_values) if self.last_values else self._fresh(now)
            return stuck.frozen
        vals = self._fresh(now)
        self.last_values = dict(vals)
        drift = self.active("drift", now)
        if drift:
            vals[self.spec["primary"]] += drift.severity * (now - drift.start)
        spike = self.active("out_of_range_spike", now)
        if spike and self.rng.random() < spike.severity:
            s = self.rng.choice([s for s in self.signals if s["sigma"] > 0])
            width = abs(s["hard"][1] - s["hard"][0])
            if self.rng.random() < 0.5:
                vals[s["name"]] = s["hard"][1] + width * self.rng.uniform(0.1, 0.5)
            else:
                vals[s["name"]] = s["hard"][0] - width * self.rng.uniform(0.1, 0.5)
        return vals

    def _next_seq(self) -> int:
        seq = self.seq
        self.seq = (self.seq + 1) & 0xFFFF
        return seq

    def telemetry_frame(self, now: float) -> bytes:
        vals = self.sample(now)
        payload = b""
        for s in self.signals:
            raw = max(-32768, min(32767, round(vals[s["name"]] / s["scale"])))
            payload += struct.pack(">Bh", s["id"], raw)
        return p.encode(p.Frame(self.dev_id, p.TELEMETRY, self._next_seq(), int(now * 1000), payload))

    def heartbeat_frame(self, now: float, boot: bool = False) -> bytes:
        payload = bytes([*self._firmware(now), 1 if boot else 0])
        return p.encode(p.Frame(self.dev_id, p.HEARTBEAT, self._next_seq(), int(now * 1000), payload))

    def stream_frames(self, now: float, tick: int) -> list[bytes]:
        if self.hung(now) or self.rebooting(now):
            return []
        if self.pending_boot:
            self.pending_boot = False
            self.seq = 0
            return [self.heartbeat_frame(now, boot=True)]
        frames = [self.telemetry_frame(now)]
        if tick % HEARTBEAT_EVERY == 0:
            frames.append(self.heartbeat_frame(now))
        drop = self.active("packet_drop", now)
        corrupt = self.active("crc_corruption", now)
        out = []
        for f in frames:
            if drop and self.rng.random() * 100 < drop.severity:
                continue
            if corrupt and self.rng.random() * 100 < corrupt.severity:
                f = self._corrupt(f)
            out.append(f)
        return out

    def _corrupt(self, frame: bytes) -> bytes:
        data = bytearray(frame)
        idx = self.rng.choice([i for i in range(1, len(data)) if i != 12])
        data[idx] ^= 1 << self.rng.randrange(8)
        return bytes(data)

    def command_delay(self, now: float, cmd: int) -> float:
        delay = self.rng.uniform(0.0005, 0.003)
        lat = self.active("latency_spike", now)
        if lat:
            delay += lat.severity / 1000.0
        if cmd == CMD_SELF_TEST:
            delay += SELF_TEST_SECONDS
        return delay

    def reply_frame(self, msg_type: int, payload: bytes, now: float) -> bytes:
        return p.encode(p.Frame(self.dev_id, msg_type, self._next_seq(), int(now * 1000), payload))

    def handle_command(self, frame: p.Frame, now: float) -> tuple[int, bytes] | None:
        """Build the reply for a command, or None if the device is not responding."""
        if self.hung(now) or self.rebooting(now) or not frame.payload:
            return None
        cmd = frame.payload[0]
        args = frame.payload[1:]
        req = struct.pack(">BH", cmd, frame.seq)
        name = COMMAND_NAMES.get(cmd)
        if name is None or name not in self.spec["commands"]:
            return p.NACK, req + bytes([NACK_UNSUPPORTED])

        def nack():
            return p.NACK, req + bytes([NACK_BAD_ARGS])

        data = b""
        if cmd == CMD_GET_VERSION:
            data = bytes(self._firmware(now))
        elif cmd == CMD_READ_REG:
            sig = next((s for s in self.signals if args and s["id"] == args[0]), None)
            if sig is None:
                return nack()
            raw = round(self._base(sig, now) / sig["scale"])
            data = struct.pack(">h", max(-32768, min(32767, raw)))
        elif cmd == CMD_SELF_TEST:
            data = bytes([0])
        elif cmd == CMD_SET_OUTPUT:
            if len(args) != 2 or args[0] != 1 or args[1] not in (0, 1):
                return nack()
            self._retarget("load_current_a", OUTPUT_ON_AMPS if args[1] else 0.0, now)
            self.output_on = bool(args[1])
        elif cmd == CMD_SET_PUMP_RPM:
            if len(args) != 2:
                return nack()
            (rpm,) = struct.unpack(">H", args)
            if rpm > 4000:
                return nack()
            self._retarget("pump_rpm", float(rpm), now)
        return p.ACK, req + data

    def _retarget(self, name: str, target: float, now: float):
        lag = self.lags[name]
        slow = self.active("slow_response", now)
        tau = LAG_TAU[(self.dtype, name)] * (slow.severity if slow else 1.0)
        self.lags[name] = Lag(lag.value(now), target, now, tau)

    def begin_reset(self, now: float):
        self.reboot_until = now + REBOOT_SECONDS
        self.pending_boot = True
        self._reset_state(self.reboot_until)
        self.last_values = None
