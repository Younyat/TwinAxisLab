# FT511938 — Código completo para bloques existentes de TIA Portal

**Destino:** PLC_1 (CPU 1214C AC/DC/Rly). Se conservan `RobotArmControl [FB1]`, `RobotArmControl_DB [DB5]`, `RobotHolding [DB4]`, `ModbusData [DB3]` y `Main [OB1]`. **No es una versión compilada ni validada en el hardware.**

Esta adaptación toma literalmente la lógica SCL del archivo adjunto y cambia únicamente `#HR.` por `"RobotHolding".Struct.` para usar el DB4 existente; no utiliza `UDT_FT511938_HR0_60` ni crea un nuevo DB. Ello **sí constituye una adaptación de referencias del código** para que coincida con tus nombres.

**NO DESCARGAR PARA MOVER MOTORES:** no están identificadas las direcciones físicas de seguridad, homing, posición y órdenes. Antes de energizar, un técnico de puesta en marcha debe revisar enclavamientos, límites y control físico. El SCL original tiene una lógica de fallos no enclavados y `SpeedPermille` no controla velocidad física; esos defectos no se corrigen aquí para no cambiar la lógica sin permiso.

## 1. `RobotHolding [DB4]` — sección `Static` > `Struct`

**Conserva** el elemento contenedor `Struct`, como en tu captura. Sustituye solo los campos interiores, **en este orden exacto**. Pega estas filas TSV en columnas `Name`, `Data type`, `Start value` de TIA Portal. No pegues la cabecera. Usa acceso no optimizado y comprueba el desplazamiento del primer miembro `Cmd` en byte 0 y `DoneCounter` en byte 120, con tamaño total 122 bytes. Si TIA añade padding y los offsets no corresponden, **detente**: el mapa Modbus ya no coincide.

```text
Cmd	Int	0
Enable	UInt	0
JogAxis	Int	0
JogDirection	Int	0
JogEnable	UInt	0
HeartbeatSequence	UInt	0
ManualTarget1	Real	0.0
ManualTarget2	Real	0.0
ManualTarget3	Real	0.0
ManualTarget4	Real	0.0
SensorPolicy	UInt	0
SensorValid	UInt	0
SensorQualityBits	UInt	0
SensorAgeMs	UInt	0
TemperatureCx100	Int	0
HumidityRHx100	UInt	0
GyroDpsx100	UInt	0
SafetyOK	UInt	0
DrivesReady	UInt	0
CommFresh	UInt	0
SensorOK	UInt	0
HomedMask	UInt	0
MinLimitMask	UInt	0
MaxLimitMask	UInt	0
WiringVerified	UInt	0
PhysicalOutputEnable	UInt	0
Pos1	Real	0.0
Pos2	Real	0.0
Pos3	Real	0.0
Pos4	Real	0.0
Target1	Real	0.0
Target2	Real	0.0
Target3	Real	0.0
Target4	Real	0.0
Status	UInt	0
ActiveMode	UInt	0
ActiveStep	UInt	0
AlarmCode	UInt	0
Done	UInt	0
IoTAlarmCode	UInt	0
ConditionState	UInt	0
SpeedPermille	UInt	0
CmdQ1toQ8Mask	UInt	0
RunMask	UInt	0
DirectionMask	UInt	0
HeartbeatEcho	UInt	0
SimulationMode	UInt	0
StartupReady	UInt	0
DoneCounter	UInt	0
```

**Importante:** 49 miembros no son 49 registros: los 12 `REAL` ocupan dos registros cada uno, total 61 registros `HR0–HR60`.

## 2. `RobotArmControl [FB1]` — tabla de declaraciones

En la sección **Input**, elimina los sufijos automáticos `_1`; los nombres deben coincidir exactamente con el código. Pega estas filas en `Name`, `Data type`, `Default value`:

```text
SafetyOK	Bool	FALSE
DrivesReady	Bool	FALSE
WiringVerified	Bool	FALSE
PhysicalOutputEnable	Bool	FALSE
FeedbackValid	Bool	FALSE
Homed	Array[1..4] of Bool	
MinLimit	Array[1..4] of Bool	
MaxLimit	Array[1..4] of Bool	
PosMeasured	Array[1..4] of Real	
```

En **Output** coloca:

```text
CmdQ1toQ8	Array[1..8] of Bool	
Run	Array[1..4] of Bool	
DirectionPositive	Array[1..4] of Bool	
```

En **InOut**, **elimina la variable `HR`**. El cuerpo accede directamente a `"RobotHolding".Struct`. No añadas ningún UDT.

En **Static**, sustituye las declaraciones antiguas por estas (tabuladas):

```text
ModeState	Int	0
LastCmd	Int	0
Step	Int	0
ManualPhase	Int	0
Fault	Int	0
ActiveAxis	Int	0
i	Int	0
q	Int	0
Delta	Real	0.0
Target	Array[1..4] of Real	
CapturedTarget	Array[1..4] of Real	
MinPos	Array[1..4] of Real	
MaxPos	Array[1..4] of Real	
Tol	Array[1..4] of Real	
AllHomed	Bool	FALSE
PosValid	Bool	FALSE
PhysicalPermitted	Bool	FALSE
ManualPermitted	Bool	FALSE
AutoPermitted	Bool	FALSE
AutoMotionAllowed	Bool	FALSE
Permitted	Bool	FALSE
MotionPresent	Bool	FALSE
IoTBlock	Bool	FALSE
IoTDegraded	Bool	FALSE
AnyMoving	Bool	FALSE
AtTarget	Bool	FALSE
ManualTargetValid	Bool	FALSE
ManualRequiresSafeHeight	Bool	FALSE
ManualBaseReady	Bool	FALSE
ManualHeightReady	Bool	FALSE
ManualExtensionReady	Bool	FALSE
ManualGripperReady	Bool	FALSE
OutputGate	Bool	FALSE
HeartbeatChanged	Bool	FALSE
HeartbeatSeen	Bool	FALSE
LastHeartbeat	UInt	0
TemperatureC	Real	0.0
HumidityRH	Real	0.0
GyroDps	Real	0.0
SettleEnable	Bool	FALSE
TimeoutEnable	Bool	FALSE
TimeoutReset	Bool	FALSE
MotionKey	DInt	0
LastMotionKey	DInt	-1
MotionIdleTimer	TON_TIME	
HeartbeatWatchdog	TON_TIME	
SettleTimer	TON_TIME	
MotionTimeout	TON_TIME	
```

Comprueba que el temporizador `TON_TIME` existe en tu versión de TIA, como se veía en tu captura previa. `RobotArmControl_DB [DB5]` se actualiza tras compilar FB1; no lo edites directamente.

## 3. `RobotArmControl [FB1]` — código completo del editor SCL inferior

**Borra todo el cuerpo antiguo** que empieza con `#Static_7`. Pega **íntegro** este bloque dentro de la región de implementación del FB1 (sin `BEGIN` y sin `END_FUNCTION_BLOCK`). Se mantiene la lógica original, con accesos Modbus adaptados al DB4.

```scl
   "RobotHolding".Struct.SafetyOK := UINT#0;
   IF #SafetyOK THEN "RobotHolding".Struct.SafetyOK := UINT#1; END_IF;
   "RobotHolding".Struct.DrivesReady := UINT#0;
   IF #DrivesReady THEN "RobotHolding".Struct.DrivesReady := UINT#1; END_IF;
   "RobotHolding".Struct.WiringVerified := UINT#0;
   IF #WiringVerified THEN "RobotHolding".Struct.WiringVerified := UINT#1; END_IF;
   "RobotHolding".Struct.PhysicalOutputEnable := UINT#0;
   IF #PhysicalOutputEnable THEN "RobotHolding".Struct.PhysicalOutputEnable := UINT#1; END_IF;
   "RobotHolding".Struct.SimulationMode := UINT#0;
   "RobotHolding".Struct.StartupReady := UINT#1;

   "RobotHolding".Struct.HomedMask := UINT#0;
   "RobotHolding".Struct.MinLimitMask := UINT#0;
   "RobotHolding".Struct.MaxLimitMask := UINT#0;
   IF #Homed[1] THEN "RobotHolding".Struct.HomedMask := "RobotHolding".Struct.HomedMask OR UINT#1; END_IF;
   IF #Homed[2] THEN "RobotHolding".Struct.HomedMask := "RobotHolding".Struct.HomedMask OR UINT#2; END_IF;
   IF #Homed[3] THEN "RobotHolding".Struct.HomedMask := "RobotHolding".Struct.HomedMask OR UINT#4; END_IF;
   IF #Homed[4] THEN "RobotHolding".Struct.HomedMask := "RobotHolding".Struct.HomedMask OR UINT#8; END_IF;
   IF #MinLimit[1] THEN "RobotHolding".Struct.MinLimitMask := "RobotHolding".Struct.MinLimitMask OR UINT#1; END_IF;
   IF #MinLimit[2] THEN "RobotHolding".Struct.MinLimitMask := "RobotHolding".Struct.MinLimitMask OR UINT#2; END_IF;
   IF #MinLimit[3] THEN "RobotHolding".Struct.MinLimitMask := "RobotHolding".Struct.MinLimitMask OR UINT#4; END_IF;
   IF #MinLimit[4] THEN "RobotHolding".Struct.MinLimitMask := "RobotHolding".Struct.MinLimitMask OR UINT#8; END_IF;
   IF #MaxLimit[1] THEN "RobotHolding".Struct.MaxLimitMask := "RobotHolding".Struct.MaxLimitMask OR UINT#1; END_IF;
   IF #MaxLimit[2] THEN "RobotHolding".Struct.MaxLimitMask := "RobotHolding".Struct.MaxLimitMask OR UINT#2; END_IF;
   IF #MaxLimit[3] THEN "RobotHolding".Struct.MaxLimitMask := "RobotHolding".Struct.MaxLimitMask OR UINT#4; END_IF;
   IF #MaxLimit[4] THEN "RobotHolding".Struct.MaxLimitMask := "RobotHolding".Struct.MaxLimitMask OR UINT#8; END_IF;

   "RobotHolding".Struct.Pos1 := #PosMeasured[1];
   "RobotHolding".Struct.Pos2 := #PosMeasured[2];
   "RobotHolding".Struct.Pos3 := #PosMeasured[3];
   "RobotHolding".Struct.Pos4 := #PosMeasured[4];

   #MinPos[1] := -171.0; #MaxPos[1] := 171.0; #Tol[1] := 1.0;
   #MinPos[2] := 130.0; #MaxPos[2] := 360.0; #Tol[2] := 2.0;
   #MinPos[3] := 0.0; #MaxPos[3] := 180.0; #Tol[3] := 2.0;
   #MinPos[4] := 12.0; #MaxPos[4] := 70.0; #Tol[4] := 2.0;

   #AllHomed := TRUE;
   #PosValid := #FeedbackValid;
   FOR #i := 1 TO 4 DO
      IF NOT #Homed[#i] THEN #AllHomed := FALSE; END_IF;
      IF (#PosMeasured[#i] <> #PosMeasured[#i]) OR
         (#PosMeasured[#i] < (#MinPos[#i] - 2.0)) OR
         (#PosMeasured[#i] > (#MaxPos[#i] + 2.0)) THEN
         #PosValid := FALSE;
      END_IF;
   END_FOR;
   "RobotHolding".Struct.SensorOK := UINT#0;
   IF #PosValid THEN "RobotHolding".Struct.SensorOK := UINT#1; END_IF;

   #HeartbeatChanged := "RobotHolding".Struct.HeartbeatSequence <> #LastHeartbeat;
   #HeartbeatWatchdog(IN := NOT #HeartbeatChanged, PT := T#2500ms);
   IF #HeartbeatChanged THEN
      #LastHeartbeat := "RobotHolding".Struct.HeartbeatSequence;
      #HeartbeatSeen := TRUE;
   END_IF;
   "RobotHolding".Struct.HeartbeatEcho := #LastHeartbeat;
   "RobotHolding".Struct.CommFresh := UINT#0;
   IF #HeartbeatSeen AND NOT #HeartbeatWatchdog.Q THEN "RobotHolding".Struct.CommFresh := UINT#1; END_IF;

   #TemperatureC := INT_TO_REAL("RobotHolding".Struct.TemperatureCx100) / 100.0;
   #HumidityRH := UINT_TO_REAL("RobotHolding".Struct.HumidityRHx100) / 100.0;
   #GyroDps := UINT_TO_REAL("RobotHolding".Struct.GyroDpsx100) / 100.0;
   #MotionPresent := #GyroDps >= 3.0;
   #MotionIdleTimer(IN := NOT #MotionPresent, PT := T#2s);

   "RobotHolding".Struct.ConditionState := UINT#0;
   "RobotHolding".Struct.IoTAlarmCode := UINT#0;
   "RobotHolding".Struct.SpeedPermille := UINT#1000;
   IF ("RobotHolding".Struct.SensorValid = UINT#0) OR
      (("RobotHolding".Struct.SensorQualityBits AND UINT#1) = UINT#0) OR
      ("RobotHolding".Struct.SensorAgeMs > UINT#2500) THEN
      "RobotHolding".Struct.ConditionState := UINT#3; "RobotHolding".Struct.IoTAlarmCode := UINT#4; "RobotHolding".Struct.SpeedPermille := UINT#0;
   ELSIF (("RobotHolding".Struct.SensorPolicy = UINT#0) OR ("RobotHolding".Struct.SensorPolicy = UINT#1)) AND
         (("RobotHolding".Struct.SensorQualityBits AND UINT#16) = UINT#0) THEN
      "RobotHolding".Struct.ConditionState := UINT#3; "RobotHolding".Struct.IoTAlarmCode := UINT#6; "RobotHolding".Struct.SpeedPermille := UINT#0;
   ELSIF (#TemperatureC >= 55.0) OR (#HumidityRH >= 85.0) OR (#GyroDps >= 220.0) THEN
      "RobotHolding".Struct.ConditionState := UINT#2; "RobotHolding".Struct.SpeedPermille := UINT#0;
      IF #TemperatureC >= 55.0 THEN "RobotHolding".Struct.IoTAlarmCode := UINT#1;
      ELSIF #HumidityRH >= 85.0 THEN "RobotHolding".Struct.IoTAlarmCode := UINT#2;
      ELSE "RobotHolding".Struct.IoTAlarmCode := UINT#3;
      END_IF;
   ELSIF (#TemperatureC >= 45.0) OR (#HumidityRH >= 75.0) OR (#GyroDps >= 120.0) THEN
      "RobotHolding".Struct.ConditionState := UINT#1; "RobotHolding".Struct.SpeedPermille := UINT#550;
   ELSIF ("RobotHolding".Struct.SensorPolicy = UINT#0) AND #MotionPresent THEN
      "RobotHolding".Struct.ConditionState := UINT#2; "RobotHolding".Struct.IoTAlarmCode := UINT#5; "RobotHolding".Struct.SpeedPermille := UINT#0;
   ELSIF ("RobotHolding".Struct.SensorPolicy = UINT#0) AND NOT #MotionIdleTimer.Q THEN
      "RobotHolding".Struct.ConditionState := UINT#2; "RobotHolding".Struct.IoTAlarmCode := UINT#5; "RobotHolding".Struct.SpeedPermille := UINT#0;
   ELSIF ("RobotHolding".Struct.SensorPolicy = UINT#1) AND NOT #MotionPresent THEN
      "RobotHolding".Struct.ConditionState := UINT#2; "RobotHolding".Struct.IoTAlarmCode := UINT#5; "RobotHolding".Struct.SpeedPermille := UINT#0;
   END_IF;

   #IoTBlock := "RobotHolding".Struct.ConditionState >= UINT#2;
   #IoTDegraded := "RobotHolding".Struct.ConditionState = UINT#1;
   #PhysicalPermitted := ("RobotHolding".Struct.Enable <> UINT#0) AND #SafetyOK AND #DrivesReady AND
                         #WiringVerified AND #PhysicalOutputEnable;
   // Manual ignores IoT policy, but remote motion still requires the PLC
   // heartbeat watchdog so a lost client cannot leave JOG energized.
   #ManualPermitted := #PhysicalPermitted AND #AllHomed AND #PosValid AND
                       ("RobotHolding".Struct.CommFresh <> UINT#0);
   #AutoMotionAllowed := FALSE;
   IF "RobotHolding".Struct.SensorPolicy = UINT#0 THEN
      #AutoMotionAllowed := (NOT #MotionPresent) AND #MotionIdleTimer.Q;
   ELSIF "RobotHolding".Struct.SensorPolicy = UINT#1 THEN
      #AutoMotionAllowed := #MotionPresent;
   END_IF;
   #AutoPermitted := #ManualPermitted AND ("RobotHolding".Struct.CommFresh <> UINT#0) AND
                     ("RobotHolding".Struct.SensorOK <> UINT#0) AND ("RobotHolding".Struct.SensorValid <> UINT#0) AND
                     (("RobotHolding".Struct.SensorQualityBits AND UINT#1) <> UINT#0) AND
                     (("RobotHolding".Struct.SensorQualityBits AND UINT#16) <> UINT#0) AND
                     ("RobotHolding".Struct.SensorAgeMs <= UINT#2500) AND NOT #IoTBlock AND
                     NOT #IoTDegraded AND #AutoMotionAllowed;

   #Fault := 0;
   #AnyMoving := FALSE;
   #AtTarget := FALSE;
   #ActiveAxis := 0;
   "RobotHolding".Struct.Done := UINT#0;
   FOR #i := 1 TO 4 DO
      #Run[#i] := FALSE;
      #DirectionPositive[#i] := FALSE;
      #Target[#i] := #PosMeasured[#i];
   END_FOR;
   FOR #q := 1 TO 8 DO #CmdQ1toQ8[#q] := FALSE; END_FOR;

   IF #ModeState = 1 THEN #Permitted := #AutoPermitted;
   ELSE #Permitted := #ManualPermitted;
   END_IF;

   IF "RobotHolding".Struct.Cmd = 0 THEN
      #ModeState := 0; #Step := 0; #ManualPhase := 0;
   ELSIF ("RobotHolding".Struct.Cmd = 1) AND (#LastCmd <> 1) THEN
      IF #ManualPermitted THEN #ModeState := 1; #Step := 1;
      ELSE #Fault := 1;
      END_IF;
   ELSIF ("RobotHolding".Struct.Cmd = 2) AND (#LastCmd <> 2) THEN
      IF #ManualPermitted THEN #ModeState := 2; #Step := 0;
      ELSE #Fault := 1;
      END_IF;
   ELSIF "RobotHolding".Struct.Cmd = 4 THEN
      #ManualTargetValid := ("RobotHolding".Struct.ManualTarget1 >= -171.0) AND ("RobotHolding".Struct.ManualTarget1 <= 171.0) AND
                            ("RobotHolding".Struct.ManualTarget2 >= 130.0) AND ("RobotHolding".Struct.ManualTarget2 <= 360.0) AND
                            ("RobotHolding".Struct.ManualTarget3 >= 0.0) AND ("RobotHolding".Struct.ManualTarget3 <= 180.0) AND
                            ("RobotHolding".Struct.ManualTarget4 >= 12.0) AND ("RobotHolding".Struct.ManualTarget4 <= 70.0);
      IF #ManualPermitted AND #ManualTargetValid THEN
         IF (#LastCmd <> 4) OR
            (ABS("RobotHolding".Struct.ManualTarget1 - #CapturedTarget[1]) > 0.01) OR
            (ABS("RobotHolding".Struct.ManualTarget2 - #CapturedTarget[2]) > 0.01) OR
            (ABS("RobotHolding".Struct.ManualTarget3 - #CapturedTarget[3]) > 0.01) OR
            (ABS("RobotHolding".Struct.ManualTarget4 - #CapturedTarget[4]) > 0.01) THEN
            #CapturedTarget[1] := "RobotHolding".Struct.ManualTarget1;
            #CapturedTarget[2] := "RobotHolding".Struct.ManualTarget2;
            #CapturedTarget[3] := "RobotHolding".Struct.ManualTarget3;
            #CapturedTarget[4] := "RobotHolding".Struct.ManualTarget4;
            #ManualRequiresSafeHeight := (#CapturedTarget[2] < 280.0) AND
                                         ((ABS(#PosMeasured[1] - #CapturedTarget[1]) > #Tol[1]) OR
                                          (ABS(#PosMeasured[3] - #CapturedTarget[3]) > #Tol[3]));
            #ManualPhase := 1; #ModeState := 4; #Step := 0;
         END_IF;
      ELSE #Fault := 4;
      END_IF;
   ELSIF "RobotHolding".Struct.Cmd = 3 THEN
      IF (#LastCmd <> 3) AND #ManualPermitted AND
         ("RobotHolding".Struct.JogAxis >= 1) AND ("RobotHolding".Struct.JogAxis <= 4) AND
         (("RobotHolding".Struct.JogDirection = -1) OR ("RobotHolding".Struct.JogDirection = 1)) THEN
         #ModeState := 3; #Step := 0;
      ELSIF #LastCmd <> 3 THEN #Fault := 7;
      END_IF;
   END_IF;
   #LastCmd := "RobotHolding".Struct.Cmd;

   IF (#ModeState = 3) AND (("RobotHolding".Struct.Cmd <> 3) OR ("RobotHolding".Struct.JogEnable = UINT#0)) THEN
      #ModeState := 0;
      #Step := 0;
   END_IF;

   IF #ModeState = 1 THEN #Permitted := #AutoPermitted;
   ELSE #Permitted := #ManualPermitted;
   END_IF;
   IF (#ModeState <> 0) AND NOT #ManualPermitted THEN
      #Fault := 1; #ModeState := 0; #Step := 0; #ManualPhase := 0;
   END_IF;

   // Same 17-pose Smart Demo used by the OpenPLC adapter and main dashboard.
   IF #ModeState = 1 THEN
      CASE #Step OF
         1:  #Target[1] := -68.754936; #Target[2] := 300.0; #Target[3] := 180.0; #Target[4] := 60.0;
         2:  #Target[1] := -68.754936; #Target[2] := 150.0; #Target[3] := 180.0; #Target[4] := 60.0;
         3:  #Target[1] := -68.754936; #Target[2] := 150.0; #Target[3] := 180.0; #Target[4] := 25.0;
         4:  #Target[1] := -68.754936; #Target[2] := 320.0; #Target[3] := 180.0; #Target[4] := 25.0;
         5:  #Target[1] := 80.214088; #Target[2] := 320.0; #Target[3] := 0.0; #Target[4] := 25.0;
         6:  #Target[1] := 80.214088; #Target[2] := 180.0; #Target[3] := 0.0; #Target[4] := 25.0;
         7:  #Target[1] := 80.214088; #Target[2] := 180.0; #Target[3] := 0.0; #Target[4] := 60.0;
         8:  #Target[1] := 80.214088; #Target[2] := 300.0; #Target[3] := 0.0; #Target[4] := 60.0;
         9:  #Target[1] := 80.214088; #Target[2] := 180.0; #Target[3] := 0.0; #Target[4] := 60.0;
         10: #Target[1] := 80.214088; #Target[2] := 180.0; #Target[3] := 0.0; #Target[4] := 25.0;
         11: #Target[1] := 80.214088; #Target[2] := 320.0; #Target[3] := 0.0; #Target[4] := 25.0;
         12: #Target[1] := -68.754936; #Target[2] := 320.0; #Target[3] := 180.0; #Target[4] := 25.0;
         13: #Target[1] := -68.754936; #Target[2] := 150.0; #Target[3] := 180.0; #Target[4] := 25.0;
         14: #Target[1] := -68.754936; #Target[2] := 150.0; #Target[3] := 180.0; #Target[4] := 60.0;
         15: #Target[1] := -68.754936; #Target[2] := 300.0; #Target[3] := 180.0; #Target[4] := 60.0;
         16: #Target[1] := 0.0; #Target[2] := 300.0; #Target[3] := 60.0; #Target[4] := 50.0;
         ELSE #Fault := 7;
      END_CASE;
      #AtTarget := TRUE;
      FOR #i := 1 TO 4 DO
         #Delta := #Target[#i] - #PosMeasured[#i];
         IF ABS(#Delta) > #Tol[#i] THEN
            #AtTarget := FALSE;
            IF ((#Delta > 0.0) AND #MaxLimit[#i]) OR ((#Delta < 0.0) AND #MinLimit[#i]) THEN
               #Fault := 4;
            ELSE
               #Run[#i] := TRUE; #DirectionPositive[#i] := #Delta > 0.0; #AnyMoving := TRUE;
            END_IF;
         END_IF;
      END_FOR;

   ELSIF #ModeState = 2 THEN
      #Target[1] := 0.0; #Target[2] := 300.0; #Target[3] := 60.0; #Target[4] := 50.0;
      #AtTarget := TRUE;
      FOR #i := 1 TO 4 DO
         IF (#ActiveAxis = 0) AND (ABS(#Target[#i] - #PosMeasured[#i]) > #Tol[#i]) THEN
            #ActiveAxis := #i; #AtTarget := FALSE;
         END_IF;
      END_FOR;
      IF #ActiveAxis <> 0 THEN
         #Delta := #Target[#ActiveAxis] - #PosMeasured[#ActiveAxis];
         IF ((#Delta > 0.0) AND #MaxLimit[#ActiveAxis]) OR ((#Delta < 0.0) AND #MinLimit[#ActiveAxis]) THEN
            #Fault := 4;
         ELSE
            #Run[#ActiveAxis] := TRUE; #DirectionPositive[#ActiveAxis] := #Delta > 0.0; #AnyMoving := TRUE;
         END_IF;
      END_IF;

   ELSIF #ModeState = 4 THEN
      #ManualBaseReady := ABS(#PosMeasured[1] - #CapturedTarget[1]) <= #Tol[1];
      #ManualHeightReady := ABS(#PosMeasured[2] - #CapturedTarget[2]) <= #Tol[2];
      #ManualExtensionReady := ABS(#PosMeasured[3] - #CapturedTarget[3]) <= #Tol[3];
      #ManualGripperReady := ABS(#PosMeasured[4] - #CapturedTarget[4]) <= #Tol[4];
      IF #ManualPhase = 1 THEN
         #Target[2] := #CapturedTarget[2];
         IF #ManualRequiresSafeHeight THEN #Target[2] := 300.0; END_IF;
         IF ABS(#PosMeasured[2] - #Target[2]) <= #Tol[2] THEN #ManualPhase := 2; END_IF;
      END_IF;
      IF (#ManualPhase = 2) AND #ManualBaseReady THEN #ManualPhase := 3; END_IF;
      IF (#ManualPhase = 3) AND #ManualExtensionReady THEN
         IF #ManualRequiresSafeHeight THEN #ManualPhase := 4; ELSE #ManualPhase := 5; END_IF;
      END_IF;
      IF (#ManualPhase = 4) AND #ManualHeightReady THEN #ManualPhase := 5; END_IF;
      IF (#ManualPhase = 5) AND #ManualGripperReady THEN #ManualPhase := 6; END_IF;

      IF #ManualPhase = 1 THEN
         #Target[2] := #CapturedTarget[2];
         IF #ManualRequiresSafeHeight THEN #Target[2] := 300.0; END_IF;
         IF ABS(#PosMeasured[2] - #Target[2]) > #Tol[2] THEN #ActiveAxis := 2; END_IF;
      ELSIF #ManualPhase = 2 THEN
         IF NOT #ManualBaseReady THEN #ActiveAxis := 1; END_IF;
      ELSIF #ManualPhase = 3 THEN
         IF NOT #ManualExtensionReady THEN #ActiveAxis := 3; END_IF;
      ELSIF #ManualPhase = 4 THEN
         IF NOT #ManualHeightReady THEN #ActiveAxis := 2; END_IF;
      ELSIF #ManualPhase = 5 THEN
         IF NOT #ManualGripperReady THEN #ActiveAxis := 4; END_IF;
      END_IF;
      #Target[1] := #CapturedTarget[1]; #Target[3] := #CapturedTarget[3]; #Target[4] := #CapturedTarget[4];
      IF (#ManualPhase <> 1) AND (#ManualPhase <> 4) THEN #Target[2] := #CapturedTarget[2]; END_IF;
      IF #ActiveAxis <> 0 THEN
         #Delta := #Target[#ActiveAxis] - #PosMeasured[#ActiveAxis];
         IF ((#Delta > 0.0) AND #MaxLimit[#ActiveAxis]) OR ((#Delta < 0.0) AND #MinLimit[#ActiveAxis]) THEN
            #Fault := 4;
         ELSE
            #Run[#ActiveAxis] := TRUE; #DirectionPositive[#ActiveAxis] := #Delta > 0.0; #AnyMoving := TRUE;
         END_IF;
      END_IF;
      #AtTarget := (#ManualPhase = 6) AND #ManualBaseReady AND #ManualHeightReady AND
                   #ManualExtensionReady AND #ManualGripperReady;

   ELSIF (#ModeState = 3) AND ("RobotHolding".Struct.Cmd = 3) AND ("RobotHolding".Struct.JogEnable <> UINT#0) THEN
      #ActiveAxis := "RobotHolding".Struct.JogAxis;
      IF (#ActiveAxis < 1) OR (#ActiveAxis > 4) OR
         (("RobotHolding".Struct.JogDirection <> -1) AND ("RobotHolding".Struct.JogDirection <> 1)) THEN
         #Fault := 7;
      ELSIF (((#ActiveAxis = 1) OR (#ActiveAxis = 3)) AND (#PosMeasured[2] < 280.0)) OR
            (("RobotHolding".Struct.JogDirection > 0) AND (#MaxLimit[#ActiveAxis] OR (#PosMeasured[#ActiveAxis] >= #MaxPos[#ActiveAxis]))) OR
            (("RobotHolding".Struct.JogDirection < 0) AND (#MinLimit[#ActiveAxis] OR (#PosMeasured[#ActiveAxis] <= #MinPos[#ActiveAxis]))) THEN
         #Fault := 4;
      ELSE
         #Run[#ActiveAxis] := TRUE; #DirectionPositive[#ActiveAxis] := "RobotHolding".Struct.JogDirection > 0; #AnyMoving := TRUE;
      END_IF;
   END_IF;

   IF NOT #Permitted OR (#Fault <> 0) THEN
      FOR #i := 1 TO 4 DO #Run[#i] := FALSE; END_FOR;
      #AnyMoving := FALSE;
   END_IF;

   #SettleEnable := ((#ModeState = 1) OR (#ModeState = 2) OR (#ModeState = 4)) AND
                    #AtTarget AND #Permitted AND (#Fault = 0);
   #SettleTimer(IN := #SettleEnable, PT := T#200ms);
   IF #SettleTimer.Q AND (#Fault = 0) THEN
      "RobotHolding".Struct.Done := UINT#1;
      "RobotHolding".Struct.DoneCounter := "RobotHolding".Struct.DoneCounter + UINT#1;
      IF #ModeState = 1 THEN
         IF #Step < 16 THEN #Step := #Step + 1; ELSE #Step := 1; END_IF;
      ELSE
         #ModeState := 0; #Step := 0; #ManualPhase := 0;
      END_IF;
   END_IF;

   #MotionKey := INT_TO_DINT(#ModeState) * DINT#100;
   IF #ModeState = 4 THEN #MotionKey := #MotionKey + INT_TO_DINT(#ManualPhase);
   ELSE #MotionKey := #MotionKey + INT_TO_DINT(#Step);
   END_IF;
   #TimeoutReset := #MotionKey <> #LastMotionKey;
   #TimeoutEnable := #AnyMoving AND #Permitted AND (#Fault = 0) AND NOT #TimeoutReset;
   #MotionTimeout(IN := #TimeoutEnable, PT := T#30s);
   #LastMotionKey := #MotionKey;
   IF #MotionTimeout.Q THEN #Fault := 5; END_IF;

   "RobotHolding".Struct.RunMask := UINT#0; "RobotHolding".Struct.DirectionMask := UINT#0;
   IF #Run[1] THEN "RobotHolding".Struct.RunMask := "RobotHolding".Struct.RunMask OR UINT#1; END_IF;
   IF #Run[2] THEN "RobotHolding".Struct.RunMask := "RobotHolding".Struct.RunMask OR UINT#2; END_IF;
   IF #Run[3] THEN "RobotHolding".Struct.RunMask := "RobotHolding".Struct.RunMask OR UINT#4; END_IF;
   IF #Run[4] THEN "RobotHolding".Struct.RunMask := "RobotHolding".Struct.RunMask OR UINT#8; END_IF;
   IF #Run[1] AND #DirectionPositive[1] THEN "RobotHolding".Struct.DirectionMask := "RobotHolding".Struct.DirectionMask OR UINT#1; END_IF;
   IF #Run[2] AND #DirectionPositive[2] THEN "RobotHolding".Struct.DirectionMask := "RobotHolding".Struct.DirectionMask OR UINT#2; END_IF;
   IF #Run[3] AND #DirectionPositive[3] THEN "RobotHolding".Struct.DirectionMask := "RobotHolding".Struct.DirectionMask OR UINT#4; END_IF;
   IF #Run[4] AND #DirectionPositive[4] THEN "RobotHolding".Struct.DirectionMask := "RobotHolding".Struct.DirectionMask OR UINT#8; END_IF;

   #OutputGate := #Permitted AND (#Fault = 0) AND #AllHomed AND #PosValid AND
                  #WiringVerified AND #PhysicalOutputEnable;
   IF #OutputGate THEN
      IF #Run[4] THEN #CmdQ1toQ8[1] := #DirectionPositive[4]; #CmdQ1toQ8[2] := NOT #DirectionPositive[4]; END_IF;
      IF #Run[3] THEN #CmdQ1toQ8[3] := #DirectionPositive[3]; #CmdQ1toQ8[4] := NOT #DirectionPositive[3]; END_IF;
      IF #Run[2] THEN #CmdQ1toQ8[5] := NOT #DirectionPositive[2]; #CmdQ1toQ8[6] := #DirectionPositive[2]; END_IF;
      IF #Run[1] THEN #CmdQ1toQ8[7] := NOT #DirectionPositive[1]; #CmdQ1toQ8[8] := #DirectionPositive[1]; END_IF;
   END_IF;
   IF (#CmdQ1toQ8[1] AND #CmdQ1toQ8[2]) OR (#CmdQ1toQ8[3] AND #CmdQ1toQ8[4]) OR
      (#CmdQ1toQ8[5] AND #CmdQ1toQ8[6]) OR (#CmdQ1toQ8[7] AND #CmdQ1toQ8[8]) THEN
      #Fault := 10;
   END_IF;
   IF #Fault <> 0 THEN
      FOR #q := 1 TO 8 DO #CmdQ1toQ8[#q] := FALSE; END_FOR;
      FOR #i := 1 TO 4 DO #Run[#i] := FALSE; END_FOR;
      "RobotHolding".Struct.RunMask := UINT#0;
      "RobotHolding".Struct.DirectionMask := UINT#0;
      #ModeState := 0; #Step := 0; #ManualPhase := 0;
   END_IF;

   "RobotHolding".Struct.CmdQ1toQ8Mask := UINT#0;
   IF #CmdQ1toQ8[1] THEN "RobotHolding".Struct.CmdQ1toQ8Mask := "RobotHolding".Struct.CmdQ1toQ8Mask OR UINT#1; END_IF;
   IF #CmdQ1toQ8[2] THEN "RobotHolding".Struct.CmdQ1toQ8Mask := "RobotHolding".Struct.CmdQ1toQ8Mask OR UINT#2; END_IF;
   IF #CmdQ1toQ8[3] THEN "RobotHolding".Struct.CmdQ1toQ8Mask := "RobotHolding".Struct.CmdQ1toQ8Mask OR UINT#4; END_IF;
   IF #CmdQ1toQ8[4] THEN "RobotHolding".Struct.CmdQ1toQ8Mask := "RobotHolding".Struct.CmdQ1toQ8Mask OR UINT#8; END_IF;
   IF #CmdQ1toQ8[5] THEN "RobotHolding".Struct.CmdQ1toQ8Mask := "RobotHolding".Struct.CmdQ1toQ8Mask OR UINT#16; END_IF;
   IF #CmdQ1toQ8[6] THEN "RobotHolding".Struct.CmdQ1toQ8Mask := "RobotHolding".Struct.CmdQ1toQ8Mask OR UINT#32; END_IF;
   IF #CmdQ1toQ8[7] THEN "RobotHolding".Struct.CmdQ1toQ8Mask := "RobotHolding".Struct.CmdQ1toQ8Mask OR UINT#64; END_IF;
   IF #CmdQ1toQ8[8] THEN "RobotHolding".Struct.CmdQ1toQ8Mask := "RobotHolding".Struct.CmdQ1toQ8Mask OR UINT#128; END_IF;

   "RobotHolding".Struct.Target1 := #Target[1]; "RobotHolding".Struct.Target2 := #Target[2];
   "RobotHolding".Struct.Target3 := #Target[3]; "RobotHolding".Struct.Target4 := #Target[4];
   "RobotHolding".Struct.AlarmCode := INT_TO_UINT(#Fault);
   "RobotHolding".Struct.ActiveMode := INT_TO_UINT(#ModeState);
   IF #ModeState = 4 THEN "RobotHolding".Struct.ActiveStep := INT_TO_UINT(#ManualPhase);
   ELSE "RobotHolding".Struct.ActiveStep := INT_TO_UINT(#Step);
   END_IF;
   IF #Fault <> 0 THEN "RobotHolding".Struct.Status := UINT#3;
   ELSIF "RobotHolding".Struct.Done <> UINT#0 THEN "RobotHolding".Struct.Status := UINT#2;
   ELSIF (#ModeState <> 0) AND #AnyMoving AND #Permitted THEN "RobotHolding".Struct.Status := UINT#1;
   ELSE "RobotHolding".Struct.Status := UINT#0;
   END_IF;
```

## 4. `Main [OB1]` — Network 1 y Network 2

**Network 1** — conserva la llamada a la instancia existente para una compilación inicial **sin funcionamiento físico**, manteniendo desconectada la potencia. Los parámetros `Input` del FB quedarán con sus valores almacenados (por defecto `FALSE` o `0`), por tanto no habrá permiso de movimiento:

```scl
"RobotArmControl_DB"();
```

Antes de hacer funcionar el robot hay que vincular **las entradas reales** `SafetyOK`, `DrivesReady`, `WiringVerified`, `PhysicalOutputEnable`, `FeedbackValid`, `Homed[1..4]`, `MinLimit[1..4]`, `MaxLimit[1..4]`, `PosMeasured[1..4]` a hardware verificado. No se puede dar una llamada operativa con esos parámetros sin conocer sus tags y direcciones reales. **Las salidas `CmdQ1toQ8` tampoco están conectadas aún a direcciones `%Q`**, y no deben conectarse por suposición.

**Network 2** — conserva exactamente tu llamada actual:

```scl
"MB_SERVER_DB"(
    DISCONNECT := FALSE,
    NDR => "ModbusData".ndr,
    DR => "ModbusData".dr,
    ERROR => "ModbusData".error,
    STATUS => "ModbusData".status,
    MB_HOLD_REG := "RobotHolding".Struct,
    CONNECT := "ModbusData".connect
);
```

Si la compilación de `MB_HOLD_REG` falla, comprueba la firma exacta de la versión MB_SERVER instalada, el tipo STRUCT y la configuración no optimizada. No cambies a una variable `Image`.

## 5. Otros bloques existentes

- `RobotArmControl_DB [DB5]`: no pegar código; recompilar FB1 para actualizar su instancia.
- `ModbusData [DB3]`: no cambiar sus campos `ndr`, `dr`, `error`, `status`, `connect` por este documento.
- `Holding Register [DB2]`: no modificar salvo referencias reales que TIA señale al compilar.
- `Startup [OB100]`: inspeccionar si escribe sobre `RobotHolding.Struct` para que no sobrescriba comandos o estados del nuevo mapa.

## 6. Secuencia de comprobación sin energizar motores

1. Reemplazar campos de `RobotHolding.Struct`; comprobar offsets y desactivar acceso optimizado.
2. Sustituir declaraciones Input/Output/Static de FB1, dejando InOut sin `HR`.
3. Pegar todo el cuerpo SCL del apartado 3.
4. Actualizar la instancia DB5 y compilar FB1.
5. Compilar OB1 con las dos redes del apartado 4. Verificar los diagnósticos de TIA; este documento no presupone compilación exitosa.
6. Con accionamientos físicamente desenergizados, verificar por Modbus que los registros están bien alineados y que ninguna señal de permiso ha sido falseada.
7. **No pasar a movimiento físico** sin completar señales reales, asignación eléctrica Q1–Q8, revisión de fallos, homing real y validación del sistema de parada segura.
