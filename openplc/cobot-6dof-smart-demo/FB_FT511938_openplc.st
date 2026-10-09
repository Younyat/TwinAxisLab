// FT511938 OpenPLC simulator adapter for TwinAxis.
//
// This POU uses the TwinAxis FT511938 adapter image HR0..HR60.
// It is intended for OpenPLC simulation and commissioning only. The real
// S7-1200 program must use measured encoder/limit/safety inputs before any
// physical output is enabled.
//
// Control image:
// HR0 Cmd: 0 manual hold, 1 demo, 2 home, 3 maintained jog, 4 goto
// HR1 Enable, HR2 JogAxis, HR3 JogDirection, HR4 JogEnable, HR5 heartbeat
// HR6..13 ManualTarget[1..4] REAL32, big endian high word first
// HR14..20 AUTO IoT policy (0=stillness, 1=motion), validity, quality, age,
// temperature, humidity, gyro. Manual Cmd=3/4 ignores this gate.
// HR21..29 PLC permits and diagnostic masks
// HR30..37 measured position REAL32, HR38..45 active target REAL32
// HR46..60 status, mode, step, alarms, masks and counters
// HR58 SimulationMode: 1 is the OpenPLC-only internal pose simulator.
//
// IMPORTANT: HR30..37 are simulated measured feedback in this POU. The POU
// integrates them toward a target so the platform can test a bidirectional
// PLC loop. Do not use this internal position integrator as feedback for a
// real motor without replacing it with measured inputs.

VAR
  Cmd AT %QW0 : UINT := 0;
  Enable AT %QW1 : UINT := 1;
  JogAxis AT %QW2 : INT := 0;
  JogDirection AT %QW3 : INT := 0;
  JogEnable AT %QW4 : UINT := 0;
  HeartbeatSequence AT %QW5 : UINT := 0;

  ManualTarget1 AT %QD3 : REAL := 0.0;
  ManualTarget2 AT %QD4 : REAL := 300.0;
  ManualTarget3 AT %QD5 : REAL := 60.0;
  ManualTarget4 AT %QD6 : REAL := 50.0;

  SensorPolicy AT %QW14 : UINT := 0;
  SensorValid AT %QW15 : UINT := 1;
  SensorQualityBits AT %QW16 : UINT := 17;
  SensorAgeMs AT %QW17 : UINT := 0;
  TemperatureCx100 AT %QW18 : INT := 2200;
  HumidityRHx100 AT %QW19 : UINT := 5000;
  GyroDpsx100 AT %QW20 : UINT := 0;

  SafetyOK AT %QW21 : UINT := 0;
  DrivesReady AT %QW22 : UINT := 0;
  CommFresh AT %QW23 : UINT := 1;
  SensorOK AT %QW24 : UINT := 1;
  HomedMask AT %QW25 : UINT := 15;
  MinLimitMask AT %QW26 : UINT := 0;
  MaxLimitMask AT %QW27 : UINT := 0;
  WiringVerified AT %QW28 : UINT := 0;
  PhysicalOutputEnable AT %QW29 : UINT := 0;

  Pos1 AT %QD15 : REAL := 0.0;
  Pos2 AT %QD16 : REAL := 300.0;
  Pos3 AT %QD17 : REAL := 60.0;
  Pos4 AT %QD18 : REAL := 50.0;
  Target1 AT %QD19 : REAL := 0.0;
  Target2 AT %QD20 : REAL := 300.0;
  Target3 AT %QD21 : REAL := 60.0;
  Target4 AT %QD22 : REAL := 50.0;

  Status AT %QW46 : UINT := 0;
  ActiveMode AT %QW47 : UINT := 0;
  ActiveStep AT %QW48 : UINT := 0;
  AlarmCode AT %QW49 : UINT := 0;
  Done AT %QW50 : UINT := 0;
  IoTAlarmCode AT %QW51 : UINT := 0;
  ConditionState AT %QW52 : UINT := 0;
  SpeedPermille AT %QW53 : UINT := 1000;
  CmdQ1toQ8Mask AT %QW54 : UINT := 0;
  RunMask AT %QW55 : UINT := 0;
  DirectionMask AT %QW56 : UINT := 0;
  HeartbeatEcho AT %QW57 : UINT := 0;
  SimulationMode AT %QW58 : UINT := 1;
  DoneCounter AT %QW60 : UINT := 0;

  SegmentTimer : TON;
  JogPulseTimer : TON;
  SettleTimer : TON;
  MotionIdleTimer : TON;

  ModeState : UINT := 0;
  LastCmd : UINT := 0;
  Step : UINT := 0;
  ActiveAxis : UINT := 0;
  LastActiveAxis : UINT := 0;
  Fault : UINT := 0;
  SegmentDurationMs : DINT := 1800;
  P : REAL := 0.0;
  SegmentRunning : BOOL := FALSE;
  AtTarget : BOOL := FALSE;
  AnyMoving : BOOL := FALSE;
  DonePulse : BOOL := FALSE;
  IoTBlock : BOOL := FALSE;
  IoTDegraded : BOOL := FALSE;
  PhysicalPermitted : BOOL := FALSE;
  ManualPermitted : BOOL := FALSE;
  AutoPermitted : BOOL := FALSE;
  AutoMotionAllowed : BOOL := FALSE;
  Permitted : BOOL := FALSE;
  MotionPresent : BOOL := FALSE;
  TemperatureC : REAL := 0.0;
  HumidityRH : REAL := 0.0;
  GyroDps : REAL := 0.0;
  MotionScale : REAL := 1.0;

  Current1 : REAL := 0.0;
  Current2 : REAL := 300.0;
  Current3 : REAL := 60.0;
  Current4 : REAL := 50.0;
  Captured1 : REAL := 0.0;
  Captured2 : REAL := 300.0;
  Captured3 : REAL := 60.0;
  Captured4 : REAL := 50.0;
  SegmentStart1 : REAL := 0.0;
  SegmentStart2 : REAL := 300.0;
  SegmentStart3 : REAL := 60.0;
  SegmentStart4 : REAL := 50.0;
  TargetValue : REAL := 0.0;
  ManualValid : BOOL := FALSE;
  DemoTarget1 : REAL := 0.0;
  DemoTarget2 : REAL := 300.0;
  DemoTarget3 : REAL := 60.0;
  DemoTarget4 : REAL := 50.0;
  AxisTarget2 : REAL := 300.0;
  ManualSafeHeight : BOOL := FALSE;
  ManualPhase : UINT := 0;
  ManualPlanActive : BOOL := FALSE;
  ManualRequiresSafeHeight : BOOL := FALSE;
  ManualTargetChanged : BOOL := FALSE;
  ManualAxisTarget2 : REAL := 300.0;
  ManualComplete : BOOL := FALSE;
  ManualTargetError : BOOL := FALSE;
  ManualBaseReady : BOOL := FALSE;
  ManualExtensionReady : BOOL := FALSE;
  ManualSafeHeightReady : BOOL := FALSE;
  ManualHeightReady : BOOL := FALSE;
  ManualGripperReady : BOOL := FALSE;
  StartupDefaultsApplied : BOOL := FALSE;
END_VAR


// 1. Simulated process image and IoT condition monitor.
// Cmd=0 is deliberately a hold state. It never writes Home values.
// OpenPLC can start a newly compiled POU with zeroed mapped output words
// instead of applying the declarations' initial values. The FT511938 file is
// explicitly the local OpenPLC simulator adapter, so recover its safe
// commissioning defaults once at the first scan. This block is deliberately
// absent from the S7-1200 program: a physical PLC must receive measured
// safety, homing and encoder values from its real I/O and must never bootstrap
// those permits in application logic.
IF NOT StartupDefaultsApplied THEN
  IF (Enable = 0) AND (HomedMask = 0) AND (SimulationMode = 0)
     AND (SafetyOK = 0) AND (DrivesReady = 0)
     AND (WiringVerified = 0) AND (PhysicalOutputEnable = 0) THEN
    Enable := 1;
    HomedMask := 15;
    SimulationMode := 1;
    Current1 := 0.0;
    Current2 := 300.0;
    Current3 := 60.0;
    Current4 := 50.0;
    Captured1 := 0.0;
    Captured2 := 300.0;
    Captured3 := 60.0;
    Captured4 := 50.0;
    DemoTarget1 := 0.0;
    DemoTarget2 := 300.0;
    DemoTarget3 := 60.0;
    DemoTarget4 := 50.0;
    AxisTarget2 := 300.0;
    ManualAxisTarget2 := 300.0;
  END_IF;
  StartupDefaultsApplied := TRUE;
END_IF;

HeartbeatEcho := HeartbeatSequence;
TemperatureC := INT_TO_REAL(TemperatureCx100) / 100.0;
HumidityRH := UINT_TO_REAL(HumidityRHx100) / 100.0;
GyroDps := UINT_TO_REAL(GyroDpsx100) / 100.0;
MotionPresent := GyroDps >= 3.0;
MotionIdleTimer(IN := NOT MotionPresent, PT := T#2s);

ConditionState := 0;
IoTAlarmCode := 0;
SpeedPermille := 1000;
MotionScale := 1.0;
IF (SensorValid = 0) OR ((SensorQualityBits AND 1) = 0) OR (SensorAgeMs > 2500) THEN
  ConditionState := 3;
  IoTAlarmCode := 4;
  MotionScale := 0.0;
  SpeedPermille := 0;
ELSIF ((SensorPolicy = 0) OR (SensorPolicy = 1)) AND ((SensorQualityBits AND 16) = 0) THEN
  ConditionState := 3;
  IoTAlarmCode := 6;
  MotionScale := 0.0;
  SpeedPermille := 0;
ELSIF (TemperatureC >= 55.0) OR (HumidityRH >= 85.0) OR (GyroDps >= 220.0) THEN
  ConditionState := 2;
  MotionScale := 0.0;
  SpeedPermille := 0;
  IF TemperatureC >= 55.0 THEN
    IoTAlarmCode := 1;
  ELSIF HumidityRH >= 85.0 THEN
    IoTAlarmCode := 2;
  ELSE
    IoTAlarmCode := 3;
  END_IF;
ELSIF (TemperatureC >= 45.0) OR (HumidityRH >= 75.0) OR (GyroDps >= 120.0) THEN
  ConditionState := 1;
  MotionScale := 0.0;
  SpeedPermille := 550;
ELSIF (SensorPolicy = 0) AND (NOT MotionPresent) AND (NOT MotionIdleTimer.Q) THEN
  ConditionState := 2;
  IoTAlarmCode := 5;
  MotionScale := 0.0;
  SpeedPermille := 0;
ELSIF (SensorPolicy = 0) AND MotionPresent THEN
  ConditionState := 2;
  IoTAlarmCode := 5;
  MotionScale := 0.0;
  SpeedPermille := 0;
ELSIF (SensorPolicy = 1) AND NOT MotionPresent THEN
  ConditionState := 2;
  IoTAlarmCode := 5;
  MotionScale := 0.0;
  SpeedPermille := 0;
END_IF;

IoTBlock := ConditionState >= 2;
IoTDegraded := ConditionState = 1;
PhysicalPermitted := (Enable <> 0) AND (HomedMask = 15)
                     AND ((SimulationMode <> 0)
                          OR ((SafetyOK <> 0) AND (DrivesReady <> 0)
                              AND (WiringVerified <> 0) AND (PhysicalOutputEnable <> 0)));

// Manual control is owned by the operator/platform. IoT validity, freshness,
// temperature, humidity and gyro motion never revoke a manual JOG or GOTO.
ManualPermitted := PhysicalPermitted;

// AUTO has two explicit IoT gates. Policy 0 runs only after the sensor has
// been still for two seconds; policy 1 runs only while sensor motion exists.
AutoMotionAllowed := FALSE;
IF SensorPolicy = 0 THEN
  AutoMotionAllowed := (NOT MotionPresent) AND MotionIdleTimer.Q;
ELSIF SensorPolicy = 1 THEN
  AutoMotionAllowed := MotionPresent;
END_IF;

AutoPermitted := PhysicalPermitted
                 AND (CommFresh <> 0)
                 AND (SensorOK <> 0)
                 AND (SensorValid <> 0)
                 AND ((SensorQualityBits AND 1) <> 0)
                 AND ((SensorQualityBits AND 16) <> 0)
                 AND (SensorAgeMs <= 2500)
                 AND (NOT IoTBlock)
                 AND (NOT IoTDegraded)
                 AND AutoMotionAllowed;

// The active mode selects the permission used by the motion engine. AUTO can
// remain latched in a safe hold while its IoT gate is false; manual remains
// independent of the IoT gate.
IF ModeState = 1 THEN
  Permitted := AutoPermitted;
ELSE
  Permitted := ManualPermitted;
END_IF;

// 2. Copy current simulated position into the public feedback image.
Pos1 := Current1;
Pos2 := Current2;
Pos3 := Current3;
Pos4 := Current4;

Done := 0;
DonePulse := FALSE;
AnyMoving := FALSE;
AtTarget := FALSE;
ActiveAxis := 0;
Fault := 0;

// 3. Command edges. Manual hold preserves the current pose.
IF Cmd = 2 THEN
  IF LastCmd <> 2 THEN
    ModeState := 2;
    Step := 0;
    Captured1 := 0.0;
    Captured2 := 300.0;
    Captured3 := 60.0;
    Captured4 := 50.0;
    ManualSafeHeight := FALSE;
    ManualPhase := 0;
    ManualPlanActive := FALSE;
    ManualRequiresSafeHeight := FALSE;
    ManualTargetChanged := FALSE;
    ManualComplete := FALSE;
    ManualTargetError := FALSE;
    LastActiveAxis := 0;
  END_IF;
ELSIF Cmd = 0 THEN
  // Cmd=0 is a hold command. It stops an active plan without changing pose.
  ModeState := 0;
  Step := 0;
  ManualSafeHeight := FALSE;
  ManualPhase := 0;
  ManualPlanActive := FALSE;
  ManualRequiresSafeHeight := FALSE;
  ManualTargetChanged := FALSE;
  ManualComplete := FALSE;
  ManualTargetError := FALSE;
  LastActiveAxis := 0;
ELSIF (Cmd = 1) AND (LastCmd <> 1) THEN
  // Starting AUTO only requires physical authority. Its IoT policy may be
  // waiting; the cycle remains held and resumes when the gate is satisfied.
  IF ManualPermitted THEN
    ModeState := 1;
    Step := 1;
    LastActiveAxis := 0;
  ELSE
    Fault := 1;
  END_IF;
ELSIF Cmd = 4 THEN
  // Cmd=4 is level-sensitive on purpose. The platform may keep Cmd=4 high
  // while it edits a target, so every changed target must be accepted.
  ManualValid := (ManualTarget1 >= -171.0) AND (ManualTarget1 <= 171.0)
                 AND (ManualTarget2 >= 130.0) AND (ManualTarget2 <= 360.0)
                 AND (ManualTarget3 >= 0.0) AND (ManualTarget3 <= 180.0)
                 AND (ManualTarget4 >= 12.0) AND (ManualTarget4 <= 70.0);
  ManualTargetError := NOT ManualValid;
  IF ManualPermitted AND ManualValid THEN
    // A new plan is started on the first Cmd=4 scan, after Cmd=0, or when
    // any target changes. The current feedback is never replaced by Home.
    IF (LastCmd <> 4) OR (ModeState <> 4)
       OR (ABS(ManualTarget1 - Captured1) > 0.01)
       OR (ABS(ManualTarget2 - Captured2) > 0.01)
       OR (ABS(ManualTarget3 - Captured3) > 0.01)
       OR (ABS(ManualTarget4 - Captured4) > 0.01) THEN
      ModeState := 4;
      Step := 0;
      Captured1 := ManualTarget1;
      Captured2 := ManualTarget2;
      Captured3 := ManualTarget3;
      Captured4 := ManualTarget4;
      ManualTargetChanged := TRUE;
      ManualPlanActive := TRUE;
      ManualComplete := FALSE;
      ManualRequiresSafeHeight := (ManualTarget2 < 280.0)
                                  AND ((ABS(Current1 - ManualTarget1) > 1.0)
                                       OR (ABS(Current3 - ManualTarget3) > 2.0));
      ManualSafeHeight := ManualRequiresSafeHeight;
      ManualPhase := 1;
      ManualAxisTarget2 := ManualTarget2;
      LastActiveAxis := 0;
    END_IF;
  ELSE
    Fault := 4;
  END_IF;
ELSIF (Cmd = 3) AND (LastCmd <> 3) THEN
  IF ManualPermitted AND (JogAxis >= 1) AND (JogAxis <= 4)
     AND ((JogDirection = -1) OR (JogDirection = 1)) THEN
    ModeState := 3;
    Step := 0;
    LastActiveAxis := 0;
  ELSE
    Fault := 7;
  END_IF;
END_IF;
LastCmd := Cmd;

IF ModeState = 1 THEN
  Permitted := AutoPermitted;
ELSE
  Permitted := ManualPermitted;
END_IF;

// Only physical authority faults cancel a mode. A temporary IoT gate loss
// leaves AUTO latched in HOLD so it can resume without a new command edge.
IF ((ModeState <> 0) AND (ModeState <> 1) AND NOT ManualPermitted)
   OR ((ModeState = 1) AND NOT ManualPermitted) THEN
  Fault := 1;
  ModeState := 0;
  Step := 0;
  ManualPhase := 0;
  ManualPlanActive := FALSE;
  ManualComplete := FALSE;
  LastActiveAxis := 0;
END_IF;

// 4. Nine point demo, Home and GOTO targets.
IF ModeState = 1 THEN
  IF Step = 1 THEN
    DemoTarget1 := -68.8; DemoTarget2 := 300.0; DemoTarget3 := 140.0; DemoTarget4 := 50.0;
  ELSIF Step = 2 THEN
    DemoTarget1 := -68.8; DemoTarget2 := 300.0; DemoTarget3 := 140.0; DemoTarget4 := 60.0;
  ELSIF Step = 3 THEN
    DemoTarget1 := -68.8; DemoTarget2 := 150.0; DemoTarget3 := 140.0; DemoTarget4 := 60.0;
  ELSIF Step = 4 THEN
    DemoTarget1 := -68.8; DemoTarget2 := 150.0; DemoTarget3 := 140.0; DemoTarget4 := 25.0;
  ELSIF Step = 5 THEN
    DemoTarget1 := -68.8; DemoTarget2 := 320.0; DemoTarget3 := 140.0; DemoTarget4 := 25.0;
  ELSIF Step = 6 THEN
    DemoTarget1 := 80.2; DemoTarget2 := 320.0; DemoTarget3 := 40.0; DemoTarget4 := 25.0;
  ELSIF Step = 7 THEN
    DemoTarget1 := 80.2; DemoTarget2 := 180.0; DemoTarget3 := 40.0; DemoTarget4 := 25.0;
  ELSIF Step = 8 THEN
    DemoTarget1 := 80.2; DemoTarget2 := 180.0; DemoTarget3 := 40.0; DemoTarget4 := 60.0;
  ELSE
    DemoTarget1 := 80.2; DemoTarget2 := 300.0; DemoTarget3 := 40.0; DemoTarget4 := 60.0;
  END_IF;
ELSIF ModeState = 2 THEN
  DemoTarget1 := 0.0; DemoTarget2 := 300.0; DemoTarget3 := 60.0; DemoTarget4 := 50.0;
ELSIF ModeState = 4 THEN
  DemoTarget1 := Captured1; DemoTarget2 := Captured2; DemoTarget3 := Captured3; DemoTarget4 := Captured4;
ELSE
  DemoTarget1 := Current1; DemoTarget2 := Current2; DemoTarget3 := Current3; DemoTarget4 := Current4;
END_IF;

Target1 := DemoTarget1;
Target2 := DemoTarget2;
Target3 := DemoTarget3;
Target4 := DemoTarget4;

// 5. Select one axis at a time. Manual GOTO uses an explicit plan so the
// platform can command a new pose without causing an implicit Home action.
// Phase 1: establish a safe height or the requested height.
// Phase 2: rotate the base while the arm is clear of the work envelope.
// Phase 3: move the extension while the arm is clear of the work envelope.
// Phase 4: descend to the requested height when a safe staging height was used.
// Phase 5: move the gripper after the structural axes have settled.
// Phase 6: wait for the final pose to remain stable before reporting Done.
AxisTarget2 := DemoTarget2;
ManualBaseReady := FALSE;
ManualExtensionReady := FALSE;
ManualSafeHeightReady := FALSE;
ManualHeightReady := FALSE;
ManualGripperReady := FALSE;

IF ModeState = 4 THEN
  // Re-evaluate readiness from feedback on every PLC scan. This prevents a
  // stale command or a delayed Modbus frame from being interpreted as motion.
  ManualBaseReady := ABS(Current1 - Captured1) <= 1.0;
  ManualExtensionReady := ABS(Current3 - Captured3) <= 2.0;
  ManualHeightReady := ABS(Current2 - Captured2) <= 2.0;
  ManualGripperReady := ABS(Current4 - Captured4) <= 2.0;

  IF ManualTargetChanged THEN
    // The command edge has already latched the targets. Clearing this flag
    // here documents that the plan now runs from the latched snapshot.
    ManualTargetChanged := FALSE;
  END_IF;

  IF NOT ManualPlanActive THEN
    // Recovery path for a retained Cmd=4 after a PLC scan restart.
    ManualPlanActive := TRUE;
    ManualComplete := FALSE;
    ManualPhase := 1;
    ManualRequiresSafeHeight := (Captured2 < 280.0)
                                AND (NOT ManualBaseReady OR NOT ManualExtensionReady);
    ManualSafeHeight := ManualRequiresSafeHeight;
    LastActiveAxis := 0;
  END_IF;

  IF ManualPhase = 0 THEN
    // Phase zero is never a moving phase. It is converted into phase one so
    // a partially retained state cannot select an axis without a plan.
    ManualPhase := 1;
    ManualComplete := FALSE;
    LastActiveAxis := 0;
  END_IF;

  IF ManualPhase = 1 THEN
    // A low final height is reached only after the base and extension are
    // finished, when either of them actually changes in this plan.
    IF ManualRequiresSafeHeight THEN
      ManualAxisTarget2 := 300.0;
    ELSE
      ManualAxisTarget2 := Captured2;
    END_IF;
    AxisTarget2 := ManualAxisTarget2;

    IF ABS(Current2 - ManualAxisTarget2) <= 2.0 THEN
      ManualSafeHeightReady := TRUE;
      ManualPhase := 2;
      LastActiveAxis := 0;
    END_IF;
  END_IF;

  IF ManualPhase = 2 THEN
    // Base rotation is allowed only after the safe height is reached.
    IF ManualBaseReady THEN
      ManualPhase := 3;
      LastActiveAxis := 0;
    END_IF;
  END_IF;

  IF ManualPhase = 3 THEN
    // Extension is treated independently from base rotation. A target that
    // changes only the extension therefore does not move the base.
    IF ManualExtensionReady THEN
      IF ManualRequiresSafeHeight THEN
        ManualPhase := 4;
      ELSE
        ManualPhase := 5;
      END_IF;
      LastActiveAxis := 0;
    END_IF;
  END_IF;

  IF ManualPhase = 4 THEN
    // Descend only after both structural axes report their final values.
    ManualAxisTarget2 := Captured2;
    AxisTarget2 := ManualAxisTarget2;
    IF ManualHeightReady THEN
      ManualPhase := 5;
      LastActiveAxis := 0;
    END_IF;
  END_IF;

  IF ManualPhase = 5 THEN
    // The gripper is deliberately last so it cannot enter the arm envelope
    // while the base, extension, or height is still being positioned.
    IF ManualGripperReady THEN
      ManualPhase := 6;
      ManualComplete := TRUE;
      LastActiveAxis := 0;
    END_IF;
  END_IF;

  IF ManualPhase = 6 THEN
    // Keep the final target visible while the settle timer verifies feedback.
    AxisTarget2 := Captured2;
    ManualComplete := ManualBaseReady AND ManualExtensionReady
                      AND ManualHeightReady AND ManualGripperReady;
  END_IF;

  IF ManualPhase = 1 THEN
    AxisTarget2 := ManualAxisTarget2;
    IF ABS(Current2 - ManualAxisTarget2) > 2.0 THEN ActiveAxis := 2; END_IF;
  ELSIF ManualPhase = 2 THEN
    IF NOT ManualBaseReady THEN ActiveAxis := 1; END_IF;
  ELSIF ManualPhase = 3 THEN
    IF NOT ManualExtensionReady THEN ActiveAxis := 3; END_IF;
  ELSIF ManualPhase = 4 THEN
    AxisTarget2 := Captured2;
    IF NOT ManualHeightReady THEN ActiveAxis := 2; END_IF;
  ELSIF ManualPhase = 5 THEN
    IF NOT ManualGripperReady THEN ActiveAxis := 4; END_IF;
  ELSE
    ActiveAxis := 0;
  END_IF;

  // A manual plan is complete only in phase six and only when all four
  // feedback values are inside their mechanical tolerances.
  AtTarget := (ManualPhase = 6) AND ManualComplete
              AND ManualBaseReady AND ManualExtensionReady
              AND ManualHeightReady AND ManualGripperReady;
  ActiveStep := ManualPhase;
ELSIF (ModeState = 1) OR (ModeState = 2) THEN
  // Demo and Home retain their original sequence and collision guards.
  IF ABS(Current2 - AxisTarget2) > 2.0 THEN
    ActiveAxis := 2;
  ELSIF ABS(Current1 - DemoTarget1) > 1.0 THEN
    IF (Current2 >= 280.0) AND (DemoTarget2 >= 280.0) THEN ActiveAxis := 1; END_IF;
  ELSIF ABS(Current3 - DemoTarget3) > 2.0 THEN
    IF (Current2 >= 280.0) AND (DemoTarget2 >= 280.0) THEN ActiveAxis := 3; END_IF;
  ELSIF ABS(Current4 - DemoTarget4) > 2.0 THEN
    IF (ABS(Current1 - DemoTarget1) <= 1.0) AND (ABS(Current2 - DemoTarget2) <= 2.0)
       AND (ABS(Current3 - DemoTarget3) <= 2.0) THEN ActiveAxis := 4; END_IF;
  END_IF;
  AtTarget := (ActiveAxis = 0) AND (ABS(Current1 - DemoTarget1) <= 1.0)
              AND (ABS(Current2 - DemoTarget2) <= 2.0)
              AND (ABS(Current3 - DemoTarget3) <= 2.0)
              AND (ABS(Current4 - DemoTarget4) <= 2.0);
END_IF;

IF ActiveAxis = 1 THEN
  SegmentDurationMs := 1800;
ELSIF ActiveAxis = 2 THEN
  SegmentDurationMs := 2200;
ELSIF ActiveAxis = 3 THEN
  SegmentDurationMs := 1800;
ELSIF ActiveAxis = 4 THEN
  SegmentDurationMs := 1200;
ELSE
  SegmentDurationMs := 1800;
END_IF;

SegmentRunning := (ActiveAxis <> 0) AND (ActiveAxis = LastActiveAxis) AND (Fault = 0) AND Permitted;
IF ActiveAxis = 1 THEN
  SegmentTimer(IN := SegmentRunning, PT := T#1800ms);
ELSIF ActiveAxis = 2 THEN
  SegmentTimer(IN := SegmentRunning, PT := T#2200ms);
ELSIF ActiveAxis = 3 THEN
  SegmentTimer(IN := SegmentRunning, PT := T#1800ms);
ELSIF ActiveAxis = 4 THEN
  SegmentTimer(IN := SegmentRunning, PT := T#1200ms);
ELSE
  SegmentTimer(IN := FALSE, PT := T#1800ms);
END_IF;
IF ActiveAxis <> LastActiveAxis THEN
  IF ActiveAxis = 1 THEN SegmentStart1 := Current1; END_IF;
  IF ActiveAxis = 2 THEN SegmentStart2 := Current2; END_IF;
  IF ActiveAxis = 3 THEN SegmentStart3 := Current3; END_IF;
  IF ActiveAxis = 4 THEN SegmentStart4 := Current4; END_IF;
  LastActiveAxis := ActiveAxis;
ELSIF ActiveAxis <> 0 AND SegmentRunning THEN
  P := TIME_TO_DINT(SegmentTimer.ET) / DINT_TO_REAL(SegmentDurationMs);
  IF P < 0.0 THEN P := 0.0; END_IF;
  IF P > 1.0 THEN P := 1.0; END_IF;
  P := P * P * (3.0 - (2.0 * P));
  IF ActiveAxis = 1 THEN Current1 := SegmentStart1 + ((DemoTarget1 - SegmentStart1) * P); END_IF;
  IF ActiveAxis = 2 THEN Current2 := SegmentStart2 + ((AxisTarget2 - SegmentStart2) * P); END_IF;
  IF ActiveAxis = 3 THEN Current3 := SegmentStart3 + ((DemoTarget3 - SegmentStart3) * P); END_IF;
  IF ActiveAxis = 4 THEN Current4 := SegmentStart4 + ((DemoTarget4 - SegmentStart4) * P); END_IF;
  AnyMoving := TRUE;
END_IF;

// 6. Maintained JOG. Release holds the current pose and never returns Home.
JogPulseTimer(IN := (ModeState = 3) AND (Cmd = 3) AND (JogEnable <> 0)
                    AND Permitted AND NOT JogPulseTimer.Q, PT := T#50ms);
IF (ModeState = 3) AND (Cmd = 3) AND (JogEnable <> 0) AND Permitted AND JogPulseTimer.Q THEN
  IF JogAxis = 1 THEN
    Current1 := Current1 + (INT_TO_REAL(JogDirection) * 1.5);
    IF Current1 < -171.0 THEN Current1 := -171.0; END_IF;
    IF Current1 > 171.0 THEN Current1 := 171.0; END_IF;
  ELSIF JogAxis = 2 THEN
    Current2 := Current2 + (INT_TO_REAL(JogDirection) * 4.0);
    IF Current2 < 130.0 THEN Current2 := 130.0; END_IF;
    IF Current2 > 360.0 THEN Current2 := 360.0; END_IF;
  ELSIF JogAxis = 3 THEN
    IF Current2 >= 280.0 THEN
      Current3 := Current3 + (INT_TO_REAL(JogDirection) * 4.0);
      IF Current3 < 0.0 THEN Current3 := 0.0; END_IF;
      IF Current3 > 180.0 THEN Current3 := 180.0; END_IF;
    END_IF;
  ELSIF JogAxis = 4 THEN
    IF (ABS(Current1 - DemoTarget1) <= 1.0) AND (ABS(Current2 - DemoTarget2) <= 2.0)
       AND (ABS(Current3 - DemoTarget3) <= 2.0) THEN
      Current4 := Current4 + (INT_TO_REAL(JogDirection) * 2.0);
      IF Current4 < 12.0 THEN Current4 := 12.0; END_IF;
      IF Current4 > 70.0 THEN Current4 := 70.0; END_IF;
    END_IF;
  END_IF;
  AnyMoving := TRUE;
END_IF;

// 7. Completion and status. The settle time prevents final-state jumps.
SettleTimer(IN := ((ModeState = 1) OR (ModeState = 2) OR (ModeState = 4))
                   AND AtTarget AND Permitted AND (Fault = 0), PT := T#200ms);
IF SettleTimer.Q AND (Fault = 0) THEN
  DonePulse := TRUE;
  Done := 1;
  DoneCounter := DoneCounter + 1;
  IF ModeState = 1 THEN
    IF Step < 9 THEN
      Step := Step + 1;
      LastActiveAxis := 0;
    ELSE
      ModeState := 0;
      Step := 0;
      LastActiveAxis := 0;
    END_IF;
  ELSE
    ModeState := 0;
    Step := 0;
    LastActiveAxis := 0;
  END_IF;
END_IF;

IF Fault <> 0 THEN
  ModeState := 0;
  Step := 0;
  LastActiveAxis := 0;
END_IF;

IF Fault <> 0 THEN
  Status := 3;
ELSIF DonePulse THEN
  Status := 2;
ELSIF (ModeState = 1) AND NOT Permitted THEN
  Status := 3;
ELSIF (ModeState <> 0) AND Permitted AND (AnyMoving OR (ActiveAxis <> 0)) THEN
  Status := 1;
ELSE
  Status := 0;
END_IF;

IF ModeState = 1 THEN
  ActiveMode := 1;
ELSIF ModeState = 3 THEN
  ActiveMode := 3;
ELSIF (ModeState = 4) OR (ModeState = 2) THEN
  ActiveMode := 4;
ELSE
  ActiveMode := 0;
END_IF;
IF ModeState = 4 THEN
  // Expose the manual planner phase instead of the demo step counter.
  ActiveStep := ManualPhase;
ELSE
  ActiveStep := Step;
END_IF;
AlarmCode := Fault;

RunMask := 0;
DirectionMask := 0;
CmdQ1toQ8Mask := 0;
IF (ModeState <> 0) AND Permitted AND (Fault = 0) AND (ActiveAxis <> 0) THEN
  IF ActiveAxis = 1 THEN RunMask := 1;
  ELSIF ActiveAxis = 2 THEN RunMask := 2;
  ELSIF ActiveAxis = 3 THEN RunMask := 4;
  ELSIF ActiveAxis = 4 THEN RunMask := 8;
  END_IF;
  IF ActiveAxis = 1 THEN
    IF DemoTarget1 >= Current1 THEN DirectionMask := 1; END_IF;
  ELSIF ActiveAxis = 2 THEN
    IF DemoTarget2 >= Current2 THEN DirectionMask := 2; END_IF;
  ELSIF ActiveAxis = 3 THEN
    IF DemoTarget3 >= Current3 THEN DirectionMask := 4; END_IF;
  ELSIF ActiveAxis = 4 THEN
    IF DemoTarget4 >= Current4 THEN DirectionMask := 8; END_IF;
  END_IF;
END_IF;

// Eight logical direction commands: Q1/Q2 gripper, Q3/Q4 extension,
// Q5/Q6 height and Q7/Q8 base. These remain diagnostic in this simulator.
IF (RunMask AND 1) <> 0 THEN CmdQ1toQ8Mask := CmdQ1toQ8Mask OR 3; END_IF;
IF (RunMask AND 2) <> 0 THEN CmdQ1toQ8Mask := CmdQ1toQ8Mask OR 12; END_IF;
IF (RunMask AND 4) <> 0 THEN CmdQ1toQ8Mask := CmdQ1toQ8Mask OR 48; END_IF;
IF (RunMask AND 8) <> 0 THEN CmdQ1toQ8Mask := CmdQ1toQ8Mask OR 192; END_IF;

// Export current feedback after the motion calculation.
Pos1 := Current1;
Pos2 := Current2;
Pos3 := Current3;
Pos4 := Current4;

IF ModeState = 0 THEN
  Target1 := Current1;
  Target2 := Current2;
  Target3 := Current3;
  Target4 := Current4;
END_IF;
