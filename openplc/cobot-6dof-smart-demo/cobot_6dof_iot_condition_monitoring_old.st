  VAR
    Command : UINT AT %QW90 := 0;
    Status : UINT AT %QW91 := 0;
    ActiveStep : UINT AT %QW92 := 0;
    ElapsedMsOut : UINT AT %QW93 := 0;
    AlarmCode : UINT AT %QW94 := 0;
    ConditionState : UINT AT %QW95 := 3;
    SpeedPermille : UINT AT %QW96 := 0;
    ProgramSignature : UINT AT %QW97 := 2101;
    J1Raw : INT AT %QW100 := 0;
    J2Raw : INT AT %QW101 := 0;
    J3Raw : INT AT %QW102 := 0;
    J4Raw : INT AT %QW103 := 0;
    J5Raw : INT AT %QW104 := 0;
    J6Raw : INT AT %QW105 := 0;
    TemperatureCx100 : INT AT %QW120 := 0;
    HumidityRHx100 : UINT AT %QW121 := 0;
    GyroDpsx100 : UINT AT %QW122 := 0;
    SensorAgeMs : UINT AT %QW123 := 65535;
    SensorValid : UINT AT %QW124 := 0;
    SensorSequence : UINT AT %QW125 := 0;
    SensorQualityBits : UINT AT %QW126 := 0;
    SensorPolicy : UINT AT %QW127 := 1;
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
    MotionPresent : BOOL := FALSE;
    DegToRadScaled : REAL := 174.5329;
  END_VAR









  
TemperatureC := INT_TO_REAL(TemperatureCx100) / 100.0;
HumidityRH := UINT_TO_REAL(HumidityRHx100) / 100.0;
GyroDps := UINT_TO_REAL(GyroDpsx100) / 100.0;
MotionPresent := GyroDps >= 3.0;
MotionIdleTimer(IN := (SensorPolicy = 1) AND (NOT MotionPresent), PT := T#2s);

ConditionState := 0;
AlarmCode := 0;
MotionScale := 1.0;
SpeedPermille := 1000;

IF (SensorValid = 0) OR ((SensorQualityBits AND 1) = 0) OR (SensorAgeMs > 2500) THEN
  ConditionState := 3;
  AlarmCode := 4;
  MotionScale := 0.0;
  SpeedPermille := 0;
ELSIF (SensorPolicy = 1) AND ((SensorQualityBits AND 16) = 0) THEN
  ConditionState := 3;
  AlarmCode := 6;
  MotionScale := 0.0;
  SpeedPermille := 0;
ELSIF (SensorPolicy = 1) AND MotionIdleTimer.Q THEN
  ConditionState := 2;
  AlarmCode := 5;
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
ELSIF ConditionState >= 2 THEN
  TimerEnabled := FALSE;
  ResetTimer := TRUE;
  Status := 3;
  ActiveStep := 0;
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

  P := DINT_TO_REAL(ElapsedMs - SegmentStartMs) / DINT_TO_REAL(SegmentDurationMs);
  IF P < 0.0 THEN P := 0.0; END_IF;
  IF P > 1.0 THEN P := 1.0; END_IF;
  P := P * P * (3.0 - (2.0 * P));

  IF ActiveStep = 1 THEN
    TargetJ1 := 0.0 + ((-55.0 - 0.0) * P);
    TargetJ2 := -35.0 + ((-10.0 - (-35.0)) * P);
    TargetJ3 := 75.0 + ((85.0 - 75.0) * P);
    TargetJ4 := 50.0 + ((25.0 - 50.0) * P);
    TargetJ5 := 0.0;
    TargetJ6 := 0.0;
  ELSIF ActiveStep = 2 THEN
    TargetJ1 := -55.0;
    TargetJ2 := -10.0 + ((15.0 - (-10.0)) * P);
    TargetJ3 := 85.0 + ((80.0 - 85.0) * P);
    TargetJ4 := 25.0 + ((-5.0 - 25.0) * P);
    TargetJ5 := 0.0;
    TargetJ6 := 0.0;
  ELSIF ActiveStep = 3 THEN
    TargetJ1 := -55.0;
    TargetJ2 := 15.0;
    TargetJ3 := 80.0;
    TargetJ4 := -5.0;
    TargetJ5 := 0.0;
    TargetJ6 := 0.0 + ((90.0 - 0.0) * P);
  ELSIF ActiveStep = 4 THEN
    TargetJ1 := -55.0 + ((50.0 - (-55.0)) * P);
    TargetJ2 := 15.0 + ((-10.0 - 15.0) * P);
    TargetJ3 := 80.0 + ((85.0 - 80.0) * P);
    TargetJ4 := -5.0 + ((25.0 - (-5.0)) * P);
    TargetJ5 := 0.0;
    TargetJ6 := 90.0;
  ELSIF ActiveStep = 5 THEN
    TargetJ1 := 50.0;
    TargetJ2 := -10.0 + ((15.0 - (-10.0)) * P);
    TargetJ3 := 85.0 + ((80.0 - 85.0) * P);
    TargetJ4 := 25.0 + ((-5.0 - 25.0) * P);
    TargetJ5 := 0.0 + ((30.0 - 0.0) * P);
    TargetJ6 := 90.0 + ((-90.0 - 90.0) * P);
  ELSE
    TargetJ1 := 50.0 + ((0.0 - 50.0) * P);
    TargetJ2 := 15.0 + ((-35.0 - 15.0) * P);
    TargetJ3 := 80.0 + ((75.0 - 80.0) * P);
    TargetJ4 := -5.0 + ((50.0 - (-5.0)) * P);
    TargetJ5 := 30.0 + ((0.0 - 30.0) * P);
    TargetJ6 := -90.0 + ((0.0 - (-90.0)) * P);
  END_IF;

  J1Deg := 0.0 + ((TargetJ1 - 0.0) * MotionScale);
  J2Deg := -35.0 + ((TargetJ2 - (-35.0)) * MotionScale);
  J3Deg := 75.0 + ((TargetJ3 - 75.0) * MotionScale);
  J4Deg := 50.0 + ((TargetJ4 - 50.0) * MotionScale);
  J5Deg := 0.0 + ((TargetJ5 - 0.0) * MotionScale);
  J6Deg := 0.0 + ((TargetJ6 - 0.0) * MotionScale);

  IF CycleTimer.Q THEN ResetTimer := TRUE; END_IF;
END_IF;

J1Raw := REAL_TO_INT((J1Deg - 0.0) * DegToRadScaled);
J2Raw := REAL_TO_INT((J2Deg - (-35.0)) * DegToRadScaled);
J3Raw := REAL_TO_INT((J3Deg - 75.0) * DegToRadScaled);
J4Raw := REAL_TO_INT((J4Deg - 50.0) * DegToRadScaled);
J5Raw := REAL_TO_INT((J5Deg - 0.0) * DegToRadScaled);
J6Raw := REAL_TO_INT((J6Deg - 0.0) * DegToRadScaled);