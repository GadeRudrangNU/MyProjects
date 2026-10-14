import struct

SYNC = 0xAA
HEADER_LEN = 13
MAX_PAYLOAD = 16

TELEMETRY, COMMAND, ACK, NACK, HEARTBEAT = 1, 2, 3, 4, 5


def _build_table() -> list[int]:
    table = []
    for byte in range(256):
        crc = byte << 8
        for _ in range(8):
            crc = ((crc << 1) ^ 0x1021) & 0xFFFF if crc & 0x8000 else (crc << 1) & 0xFFFF
        table.append(crc)
    return table


_TABLE = _build_table()


def crc16(data: bytes, crc: int = 0xFFFF) -> int:
    for b in data:
        crc = ((crc << 8) & 0xFFFF) ^ _TABLE[((crc >> 8) ^ b) & 0xFF]
    return crc


class Frame:
    __slots__ = ("device_id", "msg_type", "payload", "seq", "ts_ms")

    def __init__(self, device_id: int, msg_type: int, seq: int, ts_ms: int, payload: bytes = b""):
        self.device_id = device_id
        self.msg_type = msg_type
        self.seq = seq
        self.ts_ms = ts_ms
        self.payload = payload

    def __eq__(self, other):
        return isinstance(other, Frame) and all(getattr(self, s) == getattr(other, s) for s in self.__slots__)

    def __repr__(self):
        return f"Frame(dev={self.device_id}, type={self.msg_type}, seq={self.seq}, ts={self.ts_ms}, payload={self.payload.hex()})"


def encode(frame: Frame) -> bytes:
    if len(frame.payload) > MAX_PAYLOAD:
        raise ValueError("payload too long")
    body = struct.pack(">HBH", frame.device_id, frame.msg_type, frame.seq & 0xFFFF)
    body += (frame.ts_ms & 0xFFFFFFFFFFFF).to_bytes(6, "big")
    body += bytes([len(frame.payload)]) + frame.payload
    return bytes([SYNC]) + body + struct.pack(">H", crc16(body))


class Decoder:
    """Stream decoder that resynchronises on 0xAA and counts CRC failures."""

    def __init__(self):
        self.buf = bytearray()
        self.crc_errors = 0

    def feed(self, data: bytes) -> list[Frame]:
        self.buf += data
        frames = []
        buf = self.buf
        while True:
            start = buf.find(bytes([SYNC]))
            if start < 0:
                buf.clear()
                break
            if start:
                del buf[:start]
            if len(buf) < HEADER_LEN:
                break
            plen = buf[12]
            if plen > MAX_PAYLOAD:
                del buf[:1]
                continue
            total = HEADER_LEN + plen + 2
            if len(buf) < total:
                break
            body = bytes(buf[1 : total - 2])
            (crc,) = struct.unpack(">H", buf[total - 2 : total])
            if crc16(body) != crc:
                self.crc_errors += 1
                del buf[:total]
                continue
            device_id, msg_type, seq = struct.unpack(">HBH", body[:5])
            ts_ms = int.from_bytes(body[5:11], "big")
            frames.append(Frame(device_id, msg_type, seq, ts_ms, body[12:]))
            del buf[:total]
        return frames
