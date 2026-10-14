import statistics
import struct

import pytest

from simulator import catalog
from simulator import protocol as p
from simulator.device import CMD_GET_VERSION, CMD_SET_OUTPUT, Device, Fault

CAT = catalog.load()


def make(dtype="BCM", seed=1):
    return Device(1, dtype, CAT["types"][dtype], seed)


def decode_telemetry(raw: bytes, spec: dict) -> dict:
    (frame,) = p.Decoder().feed(raw)
    scales = {s["id"]: (s["name"], s["scale"]) for s in spec["signals"]}
    out = {}
    for i in range(0, len(frame.payload), 3):
        sid, val = struct.unpack(">Bh", frame.payload[i : i + 3])
        name, scale = scales[sid]
        out[name] = val * scale
    return out


def test_telemetry_matches_nominal():
    dev = make("BMU")
    vals = [decode_telemetry(dev.telemetry_frame(i * 0.1), dev.spec)["cell_v_1"] for i in range(200)]
    assert statistics.mean(vals) == pytest.approx(3.9, abs=0.02)
    assert 0.003 < statistics.pstdev(vals) < 0.008


def test_seq_wraps():
    dev = make()
    dev.seq = 65535
    f1 = p.Decoder().feed(dev.telemetry_frame(1.0))[0]
    f2 = p.Decoder().feed(dev.telemetry_frame(1.1))[0]
    assert (f1.seq, f2.seq) == (65535, 0)


def test_stuck_value_removes_noise():
    dev = make("BMU")
    for i in range(5):
        dev.sample(i * 0.1)
    dev.faults.append(Fault(1, "stuck_value", 1, 1.0, 100.0))
    vals = {dev.sample(1.0 + i * 0.1)["cell_v_1"] for i in range(20)}
    assert len(vals) == 1


def test_drift_grows_linearly():
    dev = make("BMU")
    dev.faults.append(Fault(1, "drift", 0.02, 10.0, 100.0))
    early = statistics.mean(dev.sample(10 + i * 0.1)["cell_v_1"] for i in range(20))
    late = statistics.mean(dev.sample(40 + i * 0.1)["cell_v_1"] for i in range(20))
    assert late - early == pytest.approx(0.02 * 30, abs=0.05)


def test_output_response_is_first_order_lag():
    dev = make("BCM")
    cmd = p.Frame(1, p.COMMAND, 5, 0, bytes([CMD_SET_OUTPUT, 1, 1]))
    assert dev.handle_command(cmd, 10.0)[0] == p.ACK
    at_tau = dev.lags["load_current_a"].value(10.08)
    assert at_tau == pytest.approx(5 * (1 - 0.3679), rel=0.01)
    assert dev.lags["load_current_a"].value(11.0) == pytest.approx(5.0, abs=0.01)


def test_slow_response_stretches_tau():
    dev = make("BCM")
    dev.faults.append(Fault(1, "slow_response", 3.0, 0.0, 100.0))
    dev.handle_command(p.Frame(1, p.COMMAND, 5, 0, bytes([CMD_SET_OUTPUT, 1, 1])), 10.0)
    assert dev.lags["load_current_a"].tau == pytest.approx(0.24)


def test_get_version_and_wrong_firmware():
    dev = make("BMU")
    cmd = p.Frame(1, p.COMMAND, 9, 0, bytes([CMD_GET_VERSION]))
    msg, payload = dev.handle_command(cmd, 1.0)
    assert msg == p.ACK and payload[3:] == bytes([2, 4, 1])
    dev.faults.append(Fault(1, "wrong_firmware", 1, 0.0, 100.0))
    assert dev.handle_command(cmd, 2.0)[1][3:] == bytes([9, 9, 9])


def test_unsupported_command_is_nacked():
    dev = make("BMU")
    msg, _ = dev.handle_command(p.Frame(1, p.COMMAND, 1, 0, bytes([CMD_SET_OUTPUT, 1, 1])), 1.0)
    assert msg == p.NACK


def test_hung_device_ignores_commands_and_stream():
    dev = make()
    dev.faults.append(Fault(1, "hang", 1, 0.0, 100.0))
    assert dev.handle_command(p.Frame(1, p.COMMAND, 1, 0, bytes([CMD_GET_VERSION])), 1.0) is None
    assert dev.stream_frames(1.0, 1) == []


def test_packet_drop_still_consumes_sequence_numbers():
    dev = make()
    dev.faults.append(Fault(1, "packet_drop", 100, 0.0, 100.0))
    assert dev.stream_frames(1.0, 1) == []
    assert dev.seq == 1


def test_reset_reboots_then_announces_boot_heartbeat():
    dev = make()
    dev.begin_reset(5.0)
    assert dev.stream_frames(5.1, 1) == []
    frames = dev.stream_frames(6.0, 2)
    hb = p.Decoder().feed(frames[0])[0]
    assert hb.msg_type == p.HEARTBEAT and hb.seq == 0 and hb.payload[3] == 1
