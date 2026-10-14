# Wire protocol

Devices talk to the gateway over TCP. The format is modelled on CAN: small fixed frames, fixed-point values, a CRC on every frame. All multi-byte fields are big endian.

```
| 0xAA | device_id | msg_type | seq | ts_ms | len | payload   | crc16 |
|  1B  |    2B     |    1B    | 2B  |  6B   | 1B  | 0 to 16 B |  2B   |
```

The CRC is CRC-16/CCITT-FALSE (polynomial 0x1021, initial value 0xFFFF) over every byte after the sync byte up to the end of the payload. `CRC16("123456789") = 0x29B1` is the reference vector used in both test suites.

| msg_type | Name | Direction | Payload |
|---|---|---|---|
| 1 | TELEMETRY | device to gateway | repeated `signal_id (u8)`, `value (i16)`, scaled per signal |
| 2 | COMMAND | gateway to device | `cmd_id (u8)` followed by arguments |
| 3 | ACK | device to gateway | `cmd_id (u8)`, `request_seq (u16)`, result bytes |
| 4 | NACK | device to gateway | `cmd_id (u8)`, `request_seq (u16)`, reason (1 unsupported, 2 bad arguments) |
| 5 | HEARTBEAT | device to gateway | `fw_major`, `fw_minor`, `fw_patch`, `flags` (bit 0 set on the first frame after boot) |

Values are fixed-point integers. A cell voltage of 3.904 V is sent as 3904 with a scale of 0.001. The scale, nominal value, noise level and limits for every signal live in [`spec/catalog.json`](../spec/catalog.json), which the simulator, gateway and runner all read.

## Sequence numbers

Every frame a device sends carries the next value of a 16-bit counter that wraps at 65535. The gateway computes the number of missed frames between two frames as `(seq - last_seq + 65536) % 65536 - 1`. A frame that arrives out of order produces a gap of 32768 or more and is ignored for loss accounting. A heartbeat with the boot flag set resets the expectation, because a rebooted device starts counting from zero again.

## Framing and resynchronisation

The decoder scans for `0xAA`, reads the length byte, waits for the whole frame and checks the CRC. A frame that fails the check is counted as a CRC error and skipped as a unit. A length byte above 16 is treated as a false sync and the decoder moves forward one byte.

## Commands

| id | Name | Arguments | Device types |
|---|---|---|---|
| 1 | READ_REG | `reg (u8)`, a signal id | all |
| 2 | RESET | none | all |
| 3 | GET_VERSION | none | all |
| 4 | SELF_TEST | none | BMU, TCM |
| 5 | SET_OUTPUT | `channel (u8)`, `state (u8)` | BCM |
| 6 | SET_PUMP_RPM | `rpm (u16)` | TCM |

A RESET is acknowledged first. The device then goes silent for 0.8 s, resets its sequence counter and announces itself with a heartbeat that has the boot flag set.
