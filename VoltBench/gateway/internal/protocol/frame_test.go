package protocol

import (
	"bytes"
	"encoding/hex"
	"math/rand"
	"testing"
)

func TestCRCKnownVector(t *testing.T) {
	if got := CRC16([]byte("123456789")); got != 0x29B1 {
		t.Fatalf("crc = %#x", got)
	}
}

func TestGoldenFrame(t *testing.T) {
	raw, err := Encode(Frame{DeviceID: 0x0102, Type: Telemetry, Seq: 7, TsMs: 0x1234, Payload: []byte{1, 0x0F, 0xA0}})
	if err != nil {
		t.Fatal(err)
	}
	want, _ := hex.DecodeString("aa0102010007000000001234" + "03" + "010fa0")
	if !bytes.Equal(raw[:16], want) {
		t.Fatalf("got %x want %x", raw[:16], want)
	}
	crc := CRC16(raw[1:16])
	if raw[16] != byte(crc>>8) || raw[17] != byte(crc) {
		t.Fatalf("bad crc bytes %x", raw[16:])
	}
}

func TestRoundTripRandom(t *testing.T) {
	r := rand.New(rand.NewSource(3))
	var d Decoder
	for i := 0; i < 500; i++ {
		payload := make([]byte, r.Intn(MaxPayload+1))
		r.Read(payload)
		in := Frame{uint16(r.Intn(65536)), uint8(1 + r.Intn(5)), uint16(r.Intn(65536)), uint64(r.Int63n(1 << 47)), payload}
		raw, _ := Encode(in)
		out := d.Feed(raw)
		if len(out) != 1 || out[0].DeviceID != in.DeviceID || out[0].Seq != in.Seq || out[0].TsMs != in.TsMs ||
			out[0].Type != in.Type || !bytes.Equal(out[0].Payload, in.Payload) {
			t.Fatalf("round trip failed for %+v -> %+v", in, out)
		}
	}
}

func TestBitFlipFailsCRC(t *testing.T) {
	raw, _ := Encode(Frame{DeviceID: 4, Type: Telemetry, Seq: 1, TsMs: 99, Payload: []byte{1, 2, 3, 4, 5, 6}})
	for i := 1; i < len(raw); i++ {
		if i == 12 {
			continue
		}
		for bit := 0; bit < 8; bit++ {
			bad := append([]byte(nil), raw...)
			bad[i] ^= 1 << bit
			var d Decoder
			if frames := d.Feed(bad); len(frames) != 0 || d.CRCErrors != 1 {
				t.Fatalf("flip byte %d bit %d: frames=%d crcErrors=%d", i, bit, len(frames), d.CRCErrors)
			}
		}
	}
}

func TestSplitReadsAndResync(t *testing.T) {
	a, _ := Encode(Frame{DeviceID: 1, Type: Heartbeat, Seq: 1, Payload: []byte{2, 4, 1, 0}})
	b, _ := Encode(Frame{DeviceID: 1, Type: Telemetry, Seq: 2, Payload: []byte{1, 0, 5}})
	stream := append(append([]byte{0x00, 0x13}, a...), b...)
	var d Decoder
	var got []Frame
	for i := 0; i < len(stream); i += 3 {
		end := i + 3
		if end > len(stream) {
			end = len(stream)
		}
		got = append(got, d.Feed(stream[i:end])...)
	}
	if len(got) != 2 || got[0].Seq != 1 || got[1].Seq != 2 {
		t.Fatalf("got %+v", got)
	}
}

func TestSeqGapWraparound(t *testing.T) {
	cases := []struct {
		last, cur uint16
		want      int
	}{{10, 11, 0}, {10, 13, 2}, {65535, 0, 0}, {65534, 1, 2}, {0, 0, -1}}
	for _, c := range cases {
		if got := SeqGap(c.last, c.cur); got != c.want {
			t.Errorf("SeqGap(%d,%d)=%d want %d", c.last, c.cur, got, c.want)
		}
	}
}
