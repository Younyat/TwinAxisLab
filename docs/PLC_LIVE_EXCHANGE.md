# PLC Live Exchange

This document describes the third right-hand drawer in TwinAxis. It is an
observability and guarded manual-control surface for the existing Modbus PLC
contract. It does not replace the automatic trajectory and it does not create
a second register map.

## What the drawer proves

The drawer separates the two directions of the process image:

| Direction | Evidence | Meaning |
| --- | --- | --- |
| `TX` | `modbus-tx` event | TwinAxis wrote a command, IoT value, policy or joint word. |
| `RX` | `plc-rx` event | OpenPLC or the physical S7-1200 answered with an FC03 process image. |
| `PLC decision` | `plc-decision` event | The PLC exposed command, status, step, alarm, condition and speed. |
| `Joint decode` | `joint-registers` event | Six received words were decoded into the KinematicGraph. |
| `3D apply` | `kinematic-apply` event | The accepted vector was applied to the digital twin. |

No value is marked live unless its source has produced a confirmed event. A
missing value is shown as `NOT OBSERVED`, `--` or `NO DATA`; it is never filled
with a demo value by this drawer.

## Endpoint detection

The source banner is derived from the active endpoint profile and current
transport state:

- `OpenPLC Runtime`: the configured OpenPLC Modbus TCP endpoint is enabled.
- `Physical PLC · S7-1200 RobotHolding`: the physical profile is enabled and
  reads HR0..HR20 from the configured host and Unit ID.
- `TwinAxis local PLC simulator`: only the existing local simulator owns the
  process image.
- `NOT CONNECTED`: no active PLC source is confirmed.

The status is not inferred from a saved IP address. `ONLINE` requires a recent
successful read; `CONNECTING / OFFLINE` means the endpoint is enabled but no
current FC03 response is available.

## Existing OpenPLC contract

The OpenPLC profile uses the conventional wire addresses already used by the
project:

| Wire | Semantic | Encoding | Direction |
| --- | --- | --- | --- |
| `%QW90` | Command | `UINT16` | TwinAxis -> PLC |
| `%QW91..96` | Status, step, elapsed time, alarm, condition, speed | `UINT16` | PLC -> TwinAxis |
| `%QW100..105` | J1..J6 | `INT16`, rad x10000 | PLC -> TwinAxis; manual write when armed |
| `%QW120..127` | IoT temperature, humidity, gyro, age, valid, sequence, quality and policy | `UINT16` | TwinAxis -> PLC |

## Physical S7-1200 RobotHolding contract

The physical profile uses the process image detected by the existing probe:

| Holding register | Semantic | Encoding | Direction |
| --- | --- | --- | --- |
| `HR0` | Command | `UINT16` | TwinAxis -> PLC |
| `HR1..6` | Status, step, elapsed time, alarm, condition, speed | `UINT16` | PLC -> TwinAxis |
| `HR7..12` | J1..J6 | `INT16`, rad x10000 | PLC -> TwinAxis; manual write when armed |
| `HR13..20` | IoT temperature, humidity, gyro, age, valid, sequence, quality and policy | `UINT16` | TwinAxis -> PLC |

The panel displays the active profile, rather than mixing `%QW` and `HR`
labels. This is important when comparing an OpenPLC capture with a physical
PLC capture.

## Delay metrics

The metric cards use only timestamps from the communication event stream:

- **Last read latency**: request start to FC03 response handling.
- **Average latency**: arithmetic mean of measured event latencies in the
  current in-memory capture session.
- **Read interval**: time between accepted FC03 samples, not the configured
  polling value.
- **Max joint jump**: largest absolute joint-vector change between two
  accepted FC03 samples, in radians.
- **Communication errors**: events explicitly marked `error`; timeout and
  connection reset details remain in the event row.

These values are diagnostic. They are not a claim that the physical machine
has a deterministic control cycle unless the PLC itself exposes that cycle.

## Platform manual PLC mode

The new mode is intentionally guarded:

1. The endpoint must be enabled and currently `ONLINE`.
2. The operator must confirm that the cell is safe and that TwinAxis is the
   sole Modbus writer.
3. TwinAxis writes `Command=0`, which is the existing `MANUAL / HOLD` contract.
4. The six joint controls become editable.
5. A joint edit writes the mapped register using the active encoding. A single
   word uses FC06; a multi-word encoding uses FC16.
6. The PLC remains polled with FC03 while manual control is active. The next
   accepted process image is therefore visible in the same drawer.
7. Every command and joint write receives a `modbus-tx` event with endpoint,
   function code, address, raw words, engineering value and latency.

Disabling the mode writes `Command=0` again and leaves the PLC in
`MANUAL / HOLD`. Selecting AUTO, HOME, an IoT policy, local manual mode or a
different endpoint cancels the remote platform authority flag. This prevents a
stale UI switch from continuing to describe control authority that no longer
exists.

## Capture and persistence

The drawer consumes the existing communication telemetry session. It can be
observed without enabling repository capture. When `Record History` is active,
the same events are persisted through `/__observability/events` below the
project telemetry session path. Persistence failures are shown as storage
warnings while the in-memory live view continues to work.

The drawer is available from both the workspace and warehouse/dashboard view,
is independent of the embedded IoT controller and deep audit drawer, and uses
the same resizable right-side interaction pattern.
