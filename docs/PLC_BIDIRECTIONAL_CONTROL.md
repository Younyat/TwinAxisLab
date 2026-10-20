# TwinAxis PLC bidirectional control

This document describes the control path implemented by the platform. It is
deliberately written as an operational contract: a Modbus socket being open
does not mean that a PLC program is running, and a value written by the twin
does not become a measured pose until the PLC returns it in its feedback image.

## 1. Authority model

The system has three possible writers:

1. The internal PLC-SIM runtime in the browser.
2. The TwinAxis platform through Modbus TCP.
3. A separate PLC engineering client or a physical PLC task.

Only one writer may own a process image at a time. When an external PLC
endpoint is enabled, the internal PLC-SIM control is intentionally stopped and
the dashboard says that the external controller has write authority. This is
an interlock against two independent trajectories fighting over the same
robot, not a motion failure.

The platform manual path requires all of the following before it writes a
pose:

- The selected endpoint is enabled.
- FC03 has returned a process image successfully.
- The platform manual lease is active.
- The PLC runtime is not known to be stopped.
- For a local simulation, the simulation permit and homed mask are present.
- For a physical PLC, homing, safety, drive, wiring and physical-output
  permits remain PLC-owned and must be reported by the PLC.

The IoT quality, freshness and motion gates are used by AUTO. They do not
cancel a valid manual JOG or GOTO. This separation prevents a stale sensor
sample from silently returning a manually positioned arm to Home.

## 2. Process-image profiles

### OpenPLC legacy `%QW`

The legacy POU uses the existing names and addresses:

| Purpose | Register | Encoding |
| --- | ---: | --- |
| Command | `%QW90` | UINT16, 0 = manual hold |
| Status | `%QW91` | UINT16 |
| Step | `%QW92` | UINT16 |
| Alarm | `%QW94` | UINT16 |
| Program signature | `%QW97` | UINT16, expected `2101` |
| J1..J6 | `%QW100..105` | signed INT16 radians x10000 |
| IoT temperature | `%QW120` | signed INT16 C x100 |
| IoT policy | `%QW127` | UINT16 |

The command and joint writes are separate blocks. The command is written as
`0` first, the complete joint vector is written next, and the next FC03 image
must show the resulting values. A missing `%QW97=2101` signature is not
treated as a running legacy POU.

### S7-1200 RobotHolding

The S7 profile uses the existing HR image:

| Purpose | Register | Encoding |
| --- | ---: | --- |
| Command | `HR0` | UINT16 |
| Status | `HR1` | UINT16 |
| Step | `HR2` | UINT16 |
| Alarm | `HR4` | UINT16 |
| Sensor policy | `HR20` | UINT16 |
| J1..J6 | `HR7..12` | signed INT16 radians x10000 |

The platform may issue a manual hold and a validated joint vector, but it does
not create safety permits, homing bits, drive-ready bits or output enables.
Those values must come from the commissioned S7 program and real inputs.

### FT511938 and Cylindrical4 Integrated IoT

Both four-axis adapters use the same command/target shape:

| Purpose | FT511938 | Integrated |
| --- | ---: | ---: |
| Command | `HR0` | `HR0` |
| Enable | `HR1` | `HR1` |
| Heartbeat | `HR5` | `HR5` |
| ManualTarget[1..4] | `HR6..13` | `HR6..13` |
| Measured Pos[1..4] | high/low `REAL32` words in `%QW30..%QW37` | `HR32..39` |
| Feedback Target[1..4] | `HR38..45` | `HR40..47` |

The values are REAL32 big-endian, high word first:

- J1 is degrees and is bounded to `-171..171`.
- J2 is millimetres and is bounded to `130..360`.
- J3 is millimetres and is bounded to `0..180`.
- J4 is gripper travel and is bounded to `12..70`.

The platform writes `Cmd=0`, writes all four REAL32 targets, then writes the
`Cmd=4` edge together with a heartbeat. The PLC owns the interpolation and
returns measured `Pos[1..4]`. The 3D views follow measured feedback, not the
unconfirmed target.

## 3. FT511938 scan diagnostic

`FB_FT511938_openplc.st` publishes `HR59 StartupReady`.

- `HR59=0`: the POU has not executed its first scan. The Modbus server may
  still answer FC03 because the server and PLC task are separate services.
- `HR59=1`: the POU has executed at least one scan. This is a diagnostic flag;
  it does not grant any physical output permit.

The local OpenPLC adapter may initialise its safe simulation defaults after
the first scan. It does not initialise physical S7 safety state. If the
dashboard shows `MODBUS ONLINE · SCAN STOPPED`, compile/download the selected
POU and set the runtime to RUN. Pressing Connect cannot start a stopped PLC
task and the platform intentionally refuses to fake its measured pose.

## 4. Twin-to-PLC transaction

Every graph edit follows this sequence:

1. Read the current graph state and merge the changed joint into a full pose
   snapshot.
2. Resolve the graph joint semantics (`J1`, `J2`, `J3`, gripper or ordered
   legacy joints).
3. Clamp or reject values using the selected adapter envelope.
4. Coalesce slider ticks for 80 ms so a drag is not transmitted as a burst.
5. Write the profile-specific HOLD command.
6. Write the complete target/vector block.
7. Write the adapter command edge where the profile requires one.
8. Request a readback of the target/command register block.
9. Record TX and readback events in communication telemetry.
10. Let the FC03 feedback poll update both 3D views.

The transaction is blocked when the PLC scan is stopped, when the endpoint is
offline, when platform manual authority is absent, or when a physical permit
is missing. A failed write leaves the old feedback pose visible and reports a
NACK in the diagnostic line.

## 5. PLC-to-twin transaction

The poller reads the selected process image at the configured period. It
decodes the exact profile, records latency and sample interval, calculates
the largest joint jump, and publishes the measured pose to both views. A
short presentation smoothing filter is applied only to rendering; it never
writes a smoothed value back into the PLC.

The following are retained in communication telemetry:

- Endpoint, unit ID, FC03/FC06/FC16 operation and register range.
- Raw registers and decoded engineering values.
- TX latency and sample interval.
- PLC mode, status, step, alarm, condition and heartbeat.
- Manual authority and direction (`twin-to-plc` or `plc-to-twin`).
- Readback length and errors.
- Maximum joint jump for diagnosing bursts or interrupted motion.

## 6. Diagnosis of the reported screen

The screen with `RAW [0, 0, ...]`, `SCAN STOPPED`, and zero J2/J4 is not a
valid stationary robot pose. It is a stopped task with an empty/default
process image. The old legacy warning appears when the platform is reading
the `%QW` profile while the loaded program is the FT adapter. The correct
choices are mutually exclusive:

- Load `cobot_6dof_iot_condition_monitoring.st` and select `OpenPLC %QW`.
- Load `FB_FT511938_openplc.st` and select `Physical FT511938 Unified`.

Do not use `%QW97` as a signature for the FT adapter. Its identity is the
HR0..60 shape plus `HR59 StartupReady` after the POU starts.

## 7. Commissioning checklist

### 7.1 When the dashboard shows `HR59=1` but `HR30..45=0`

This combination has a specific meaning and must not be interpreted as a
valid Home pose. `HR59=1` proves that some FT POU has executed a scan, but
zero J2 and J4 values are outside the declared mechanical envelope. In that
case the runtime is serving an older generated program, the wrong POU, or a
REAL32 mapping that is not serialized into the `%QW30..%QW45` holding-register image.

The source of truth in this repository is:

`C:\Users\Usuario\Desktop\NICS\3D Asset Platform V2\openplc\cobot-6dof-smart-demo\FB_FT511938_openplc.st`

The generated file under `%LOCALAPPDATA%\OpenPLC Runtime\...\generated\program.st`
is an output of the OpenPLC compilation workflow. It must not be edited by
hand because the next compile replaces it. If its startup logic does not
contain the simulator-only invalid-position recovery from the source POU,
the runtime has not received the current source yet.

Use this exact sequence in OpenPLC Editor:

1. Stop any external Modbus writer and put the local runtime in STOP.
2. Open the source POU above in the OpenPLC project used by the runtime.
3. Run **Clean build and upload** to the local OpenPLC Runtime v4.
4. Wait for compilation status `SUCCESS`, then press **Start PLC**.
5. Read HR59, HR58, HR25, HR30..37 and HR38..45 before connecting motion.
6. Continue only when HR59=1, HR58=1, HR25=15, J2 is inside 128..362 mm,
   J4 is inside 10..72 mm, and the target block is a valid REAL32 vector.

For OpenPLC Runtime v4, the FT adapter does not map REAL variables directly
onto `%QD3..%QD22`. It receives command REAL32 values as high/low words in
`%QW6..%QW13` and publishes measured positions and active targets as high/low
words in `%QW30..%QW45`. This explicit serialization is required for FC03 to
expose the REAL32 bit patterns as holding registers.

The dashboard now reports this exact stale-image condition instead of calling
it a successful connection. Until the recompilation is completed, JOG/GOTO
remain disabled and no platform target is written to the PLC. This is
intentional: FC03 availability alone cannot prove that the selected POU is
running or that its measured feedback image is valid.

Before testing a local FT adapter:

1. Stop any external engineering client with write authority.
2. Load the exact FT POU, not the legacy cobot POU.
3. Compile and download it to OpenPLC.
4. Set the OpenPLC runtime to RUN.
5. Confirm `HR59=1`, `SimulationMode=1`, `HomedMask=15`, and valid positions.
6. Select `Physical FT511938 Unified · proposed HR0..60`.
7. Probe, connect, and wait for `SCAN`.
8. Enable `Manual PLC` only after the dashboard reports valid feedback.
9. Send a small GOTO inside the declared envelope.
10. Confirm the target write, readback, measured position and both 3D views.
11. Release manual authority with the robot in HOLD.

Before testing a physical S7-1200:

1. Commission the DB/MB_SERVER register offsets independently.
2. Verify encoder feedback and limit inputs in the PLC project.
3. Confirm the PLC reports homed and safety permits.
4. Confirm the selected profile is S7-1200 RobotHolding.
5. Use a guarded, low-risk manual target first.
6. Never copy the OpenPLC simulator bootstrap into the physical program.

## 8. What this change does not do

This implementation does not bypass E-stop, guard, drive, homing, wiring or
physical-output interlocks. It does not claim a PLC is running because a TCP
socket answers. It does not replace encoder feedback with a platform target.
It does not remove the previous profile selector, legacy live exchange view,
Start Demo controls or existing local PLC-SIM mode.

The visible result is intentionally conservative: a stopped PLC produces a
clear stopped diagnostic and no manual write; a running PLC produces a traced
target transaction and the twin follows the PLC feedback.

