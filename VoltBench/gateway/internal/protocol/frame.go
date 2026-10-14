package protocol

import (
	"encoding/binary"
	"errors"
)

const (
	Sync       = 0xAA
	HeaderLen  = 13
	MaxPayload = 16
)

const (
	Telemetry = 1
	Command   = 2
	Ack       = 3
	Nack      = 4
	Heartbeat = 5
)

type Frame struct {
	DeviceID uint16
	Type     uint8
	Seq      uint16
	TsMs     uint64
	Payload  []byte
}

var crcTable = buildTable()

func buildTable() [256]uint16 {
	var t [256]uint16
	for i := 0; i < 256; i++ {
		crc := uint16(i) << 8
		for j := 0; j < 8; j++ {
			if crc&0x8000 != 0 {
				crc = crc<<1 ^ 0x1021
			} else {
				crc <<= 1
			}
		}
		t[i] = crc
	}
	return t
}

func CRC16(data []byte) uint16 {
	crc := uint16(0xFFFF)
	for _, b := range data {
		crc = crc<<8 ^ crcTable[byte(crc>>8)^b]
	}
	return crc
}

var ErrPayloadTooLong = errors.New("payload too long")

func Encode(f Frame) ([]byte, error) {
	if len(f.Payload) > MaxPayload {
		return nil, ErrPayloadTooLong
	}
	out := make([]byte, 0, HeaderLen+len(f.Payload)+2)
	out = append(out, Sync)
	out = binary.BigEndian.AppendUint16(out, f.DeviceID)
	out = append(out, f.Type)
	out = binary.BigEndian.AppendUint16(out, f.Seq)
	var ts [8]byte
	binary.BigEndian.PutUint64(ts[:], f.TsMs&0xFFFFFFFFFFFF)
	out = append(out, ts[2:]...)
	out = append(out, byte(len(f.Payload)))
	out = append(out, f.Payload...)
	out = binary.BigEndian.AppendUint16(out, CRC16(out[1:]))
	return out, nil
}

// Decoder extracts frames from a byte stream, resynchronising on the sync byte
// and counting frames that fail their checksum.
type Decoder struct {
	buf       []byte
	CRCErrors uint64
}

func (d *Decoder) Feed(data []byte) []Frame {
	d.buf = append(d.buf, data...)
	var frames []Frame
	for {
		start := indexByte(d.buf, Sync)
		if start < 0 {
			d.buf = d.buf[:0]
			break
		}
		if start > 0 {
			d.buf = d.buf[start:]
		}
		if len(d.buf) < HeaderLen {
			break
		}
		plen := int(d.buf[12])
		if plen > MaxPayload {
			d.buf = d.buf[1:]
			continue
		}
		total := HeaderLen + plen + 2
		if len(d.buf) < total {
			break
		}
		want := binary.BigEndian.Uint16(d.buf[total-2 : total])
		if CRC16(d.buf[1:total-2]) != want {
			d.CRCErrors++
			d.buf = d.buf[total:]
			continue
		}
		var ts [8]byte
		copy(ts[2:], d.buf[6:12])
		f := Frame{
			DeviceID: binary.BigEndian.Uint16(d.buf[1:3]),
			Type:     d.buf[3],
			Seq:      binary.BigEndian.Uint16(d.buf[4:6]),
			TsMs:     binary.BigEndian.Uint64(ts[:]),
			Payload:  append([]byte(nil), d.buf[13:13+plen]...),
		}
		frames = append(frames, f)
		d.buf = d.buf[total:]
	}
	if len(d.buf) == 0 {
		d.buf = nil
	}
	return frames
}

func indexByte(b []byte, c byte) int {
	for i, v := range b {
		if v == c {
			return i
		}
	}
	return -1
}

// SeqGap returns how many frames were missed between two consecutive sequence
// numbers, accounting for 16-bit wraparound.
func SeqGap(last, cur uint16) int {
	return (int(cur)-int(last)+65536)%65536 - 1
}
