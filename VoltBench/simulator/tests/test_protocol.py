from hypothesis import given
from hypothesis import strategies as st

from simulator import protocol as p


def test_crc_known_vector():
    assert p.crc16(b"123456789") == 0x29B1


def test_golden_frame_bytes():
    frame = p.Frame(0x0102, p.TELEMETRY, 7, 0x0000_0000_1234, bytes([1, 0x0F, 0xA0]))
    raw = p.encode(frame)
    assert raw[:13] == bytes.fromhex("aa 0102 01 0007 000000001234 03".replace(" ", ""))
    assert raw[13:16] == bytes([1, 0x0F, 0xA0])
    assert int.from_bytes(raw[16:], "big") == p.crc16(raw[1:16])


frames = st.builds(
    p.Frame,
    st.integers(0, 0xFFFF),
    st.integers(1, 5),
    st.integers(0, 0xFFFF),
    st.integers(0, 2**48 - 1),
    st.binary(max_size=16),
)


@given(frames)
def test_roundtrip(frame):
    d = p.Decoder()
    assert d.feed(p.encode(frame)) == [frame]
    assert d.crc_errors == 0


@given(frames, st.data())
def test_single_bit_flip_never_decodes_as_valid_frame(frame, data):
    raw = bytearray(p.encode(frame))
    candidates = [i for i in range(1, len(raw)) if i != 12]
    idx = data.draw(st.sampled_from(candidates))
    raw[idx] ^= 1 << data.draw(st.integers(0, 7))
    d = p.Decoder()
    assert d.feed(bytes(raw)) == []
    assert d.crc_errors == 1


@given(st.lists(frames, min_size=1, max_size=6), st.integers(1, 7))
def test_stream_split_across_reads(frame_list, chunk):
    blob = b"".join(p.encode(f) for f in frame_list)
    d = p.Decoder()
    out = []
    for i in range(0, len(blob), chunk):
        out += d.feed(blob[i : i + chunk])
    assert out == frame_list


def test_resync_after_garbage():
    f = p.Frame(5, p.HEARTBEAT, 1, 99, bytes([2, 4, 1, 0]))
    d = p.Decoder()
    assert d.feed(b"\x00\x13\x37" + p.encode(f)) == [f]
