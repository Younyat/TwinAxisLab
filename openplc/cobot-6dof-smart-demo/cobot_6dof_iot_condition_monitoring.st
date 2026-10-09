VAR
  Command AT %QW90 : UINT := 0;
  Status AT %QW91 : UINT := 0;
  ActiveStep AT %QW92 : UINT := 0;
  ElapsedMsOut AT %QW93 : UINT := 0;
  AlarmCode AT %QW94 : UINT := 0;
  ConditionState AT %QW95 : UINT := 3;
  SpeedPermille AT %QW96 : UINT := 0;
  ProgramSignature AT %QW97 : UINT := 2101;
  J1Raw AT %QW100 : INT := 0;
  J2Raw AT %QW101 : INT := 0;
  J3Raw AT %QW102 : INT := 0;
  J4Raw AT %QW103 : INT := 0;
  J5Raw AT %QW104 : INT := 0;
  J6Raw AT %QW105 : INT := 0;
  TemperatureCx100 AT %QW120 : INT := 0;
  HumidityRHx100 AT %QW121 : UINT := 0;
  GyroDpsx100 AT %QW122 : UINT := 0;
  SensorAgeMs AT %QW123 : UINT := 65535;
  SensorValid AT %QW124 : UINT := 0;
  SensorSequence AT %QW125 : UINT := 0;
  SensorQualityBits AT %QW126 : UINT := 0;
  SensorPolicy AT %QW127 : UINT := 0;
  CycleTimer : TON;
  MotionIdleTimer : TON;
  TimerEnabled : BOOL := FALSE;
  ResetTimer : BOOL := TRUE;
  ElapsedMs : DINT := 0;
  SegmentStartMs : DINT := 0;
  SegmentDurationMs : DINT := 1;
  P : REAL := 0.0;
  MotionScale : REAL := 1.0;
  TemperatureC : REAL := 0.0;
  HumidityRH : REAL := 0.0;
  GyroDps : REAL := 0.0;
  J1Deg : REAL := 0.0;
  J2Deg : REAL := -35.0;
  J3Deg : REAL := 75.0;
  J4Deg : REAL := 50.0;
  J5Deg : REAL := 0.0;
  J6Deg : REAL := 0.0;
  TargetJ1 : REAL := 0.0;
  TargetJ2 : REAL := -35.0;
  TargetJ3 : REAL := 75.0;
  TargetJ4 : REAL := 50.0;
  TargetJ5 : REAL := 0.0;
  TargetJ6 : REAL := 0.0;
  SegmentStartJ1 : REAL := 0.0;
  SegmentStartJ2 : REAL := -35.0;
  SegmentStartJ3 : REAL := 75.0;
  SegmentStartJ4 : REAL := 50.0;
  SegmentStartJ5 : REAL := 0.0;
  SegmentStartJ6 : REAL := 0.0;
  PreviousStep : UINT := 0;
  PreviousP : REAL := 0.0;
  ProgressDelta : REAL := 0.0;
  MotionPresent : BOOL := FALSE;
  DegToRadScaled : REAL := 174.5329;
END_VAR


ProgramSignature := 2101;

TemperatureC := INT_TO_REAL(TemperatureCx100) / 100.0;
HumidityRH := UINT_TO_REAL(HumidityRHx100) / 100.0;
GyroDps := UINT_TO_REAL(GyroDpsx100) / 100.0;
MotionPresent := GyroDps >= 3.0;
MotionIdleTimer(IN := NOT MotionPresent, PT := T#2s);

ConditionState := 0;
AlarmCode := 0;
MotionScale := 1.0;
SpeedPermille := 1000;

IF (SensorValid = 0) OR ((SensorQualityBits AND 1) = 0) OR (SensorAgeMs > 2500) THEN
  ConditionState := 3;
  AlarmCode := 4;
  MotionScale := 0.0;
  SpeedPermille := 0;
ELSIF ((SensorPolicy = 0) OR (SensorPolicy = 1)) AND ((SensorQualityBits AND 16) = 0) THEN
  ConditionState := 3;
  AlarmCode := 6;
  MotionScale := 0.0;
  SpeedPermille := 0;
ELSIF (TemperatureC >= 55.0) OR (HumidityRH >= 85.0) OR (GyroDps >= 220.0) THEN
  ConditionState := 2;
  MotionScale := 0.0;
  SpeedPermille := 0;
  IF TemperatureC >= 55.0 THEN
    AlarmCode := 1;
  ELSIF HumidityRH >= 85.0 THEN
    AlarmCode := 2;
  ELSE
    AlarmCode := 3;
  END_IF;
ELSIF (TemperatureC >= 45.0) OR (HumidityRH >= 75.0) OR (GyroDps >= 120.0) THEN
  ConditionState := 1;
  MotionScale := 0.55;
  SpeedPermille := 550;
ELSIF (SensorPolicy = 0) AND (NOT MotionPresent) AND (NOT MotionIdleTimer.Q) THEN
  ConditionState := 2;
  AlarmCode := 5;
  MotionScale := 0.0;
  SpeedPermille := 0;
ELSIF (SensorPolicy = 0) AND MotionPresent THEN
  ConditionState := 2;
  AlarmCode := 5;
  MotionScale := 0.0;
  SpeedPermille := 0;
ELSIF (SensorPolicy = 1) AND (NOT MotionPresent) THEN
  ConditionState := 2;
  AlarmCode := 5;
  MotionScale := 0.0;
  SpeedPermille := 0;
END_IF;

IF Command = 2 THEN
  TimerEnabled := FALSE;
  ResetTimer := TRUE;
  Status := 2;
  ActiveStep := 0;
  ElapsedMsOut := 0;
  J1Deg := 0.0;
  J2Deg := -35.0;
  J3Deg := 75.0;
  J4Deg := 50.0;
  J5Deg := 0.0;
  J6Deg := 0.0;
  PreviousStep := 0;
  PreviousP := 0.0;
ELSIF Command = 0 THEN
  TimerEnabled := FALSE;
  ResetTimer := TRUE;
  Status := 0;
  ActiveStep := 0;
  J1Deg := 0.0 + (INT_TO_REAL(J1Raw) / DegToRadScaled);
  J2Deg := -35.0 + (INT_TO_REAL(J2Raw) / DegToRadScaled);
  J3Deg := 75.0 + (INT_TO_REAL(J3Raw) / DegToRadScaled);
  J4Deg := 50.0 + (INT_TO_REAL(J4Raw) / DegToRadScaled);
  J5Deg := 0.0 + (INT_TO_REAL(J5Raw) / DegToRadScaled);
  J6Deg := 0.0 + (INT_TO_REAL(J6Raw) / DegToRadScaled);
  PreviousStep := 0;
  PreviousP := 0.0;
ELSIF ConditionState >= 2 THEN
  TimerEnabled := FALSE;
  ResetTimer := TRUE;
  Status := 3;
  ActiveStep := 0;
  PreviousStep := 0;
  PreviousP := 0.0;
ELSE
  Status := 1;
  IF ResetTimer THEN
    TimerEnabled := FALSE;
    ResetTimer := FALSE;
  ELSE
    TimerEnabled := TRUE;
  END_IF;

  CycleTimer(IN := TimerEnabled, PT := T#10s);
  ElapsedMs := TIME_TO_DINT(CycleTimer.ET);
  IF ElapsedMs > 10000 THEN ElapsedMs := 10000; END_IF;
  ElapsedMsOut := DINT_TO_UINT(ElapsedMs);

  IF ElapsedMs < 1400 THEN
    ActiveStep := 1; SegmentStartMs := 0; SegmentDurationMs := 1400;
  ELSIF ElapsedMs < 2400 THEN
    ActiveStep := 2; SegmentStartMs := 1400; SegmentDurationMs := 1000;
  ELSIF ElapsedMs < 3200 THEN
    ActiveStep := 3; SegmentStartMs := 2400; SegmentDurationMs := 800;
  ELSIF ElapsedMs < 5600 THEN
    ActiveStep := 4; SegmentStartMs := 3200; SegmentDurationMs := 2400;
  ELSIF ElapsedMs < 7600 THEN
    ActiveStep := 5; SegmentStartMs := 5600; SegmentDurationMs := 2000;
  ELSE
    ActiveStep := 6; SegmentStartMs := 7600; SegmentDurationMs := 2400;
  END_IF;

  IF ActiveStep <> PreviousStep THEN
    SegmentStartJ1 := J1Deg;
    SegmentStartJ2 := J2Deg;
    SegmentStartJ3 := J3Deg;
    SegmentStartJ4 := J4Deg;
    SegmentStartJ5 := J5Deg;
    SegmentStartJ6 := J6Deg;
    PreviousStep := ActiveStep;
    PreviousP := 0.0;
  END_IF;

  P := DINT_TO_REAL(ElapsedMs - SegmentStartMs) / DINT_TO_REAL(SegmentDurationMs);
  IF P < 0.0 THEN P := 0.0; END_IF;
  IF P > 1.0 THEN P := 1.0; END_IF;
  P := P * P * (3.0 - (2.0 * P));
  ProgressDelta := P - PreviousP;
  IF ProgressDelta < 0.0 THEN ProgressDelta := 0.0; END_IF;
  IF ProgressDelta > 1.0 THEN ProgressDelta := 1.0; END_IF;
  PreviousP := P;

  IF ActiveStep = 1 THEN
    TargetJ1 := -55.0; TargetJ2 := -10.0; TargetJ3 := 85.0; TargetJ4 := 25.0;
    TargetJ5 := 0.0;
    TargetJ6 := 0.0;
  ELSIF ActiveStep = 2 THEN
    TargetJ1 := -55.0;
    TargetJ2 := 15.0; TargetJ3 := 80.0; TargetJ4 := -5.0;
    TargetJ5 := 0.0;
    TargetJ6 := 0.0;
  ELSIF ActiveStep = 3 THEN
    TargetJ1 := -55.0;
    TargetJ2 := 15.0;
    TargetJ3 := 80.0;
    TargetJ4 := -5.0;
    TargetJ5 := 0.0;
    TargetJ6 := 90.0;
  ELSIF ActiveStep = 4 THEN
    TargetJ1 := 50.0; TargetJ2 := -10.0; TargetJ3 := 85.0; TargetJ4 := 25.0;
    TargetJ5 := 0.0;
    TargetJ6 := 90.0;
  ELSIF ActiveStep = 5 THEN
    TargetJ1 := 50.0;
    TargetJ2 := 15.0; TargetJ3 := 80.0; TargetJ4 := -5.0;
    TargetJ5 := 30.0; TargetJ6 := -90.0;
  ELSE
    TargetJ1 := 0.0; TargetJ2 := -35.0; TargetJ3 := 75.0;
    TargetJ4 := 50.0; TargetJ5 := 0.0; TargetJ6 := 0.0;
  END_IF;

  J1Deg := J1Deg + ((TargetJ1 - SegmentStartJ1) * ProgressDelta * MotionScale);
  J2Deg := J2Deg + ((TargetJ2 - SegmentStartJ2) * ProgressDelta * MotionScale);
  J3Deg := J3Deg + ((TargetJ3 - SegmentStartJ3) * ProgressDelta * MotionScale);
  J4Deg := J4Deg + ((TargetJ4 - SegmentStartJ4) * ProgressDelta * MotionScale);
  J5Deg := J5Deg + ((TargetJ5 - SegmentStartJ5) * ProgressDelta * MotionScale);
  J6Deg := J6Deg + ((TargetJ6 - SegmentStartJ6) * ProgressDelta * MotionScale);

  IF CycleTimer.Q THEN ResetTimer := TRUE; END_IF;
END_IF;

J1Raw := REAL_TO_INT((J1Deg - 0.0) * DegToRadScaled);
J2Raw := REAL_TO_INT((J2Deg - (-35.0)) * DegToRadScaled);
J3Raw := REAL_TO_INT((J3Deg - 75.0) * DegToRadScaled);
J4Raw := REAL_TO_INT((J4Deg - 50.0) * DegToRadScaled);
J5Raw := REAL_TO_INT((J5Deg - 0.0) * DegToRadScaled);
J6Raw := REAL_TO_INT((J6Deg - 0.0) * DegToRadScaled);
