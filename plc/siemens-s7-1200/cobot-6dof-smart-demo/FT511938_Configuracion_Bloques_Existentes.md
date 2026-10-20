# Configuración de los bloques existentes en TIA Portal — FT511938

**Objetivo:** reutilizar `RobotHolding [DB4]`, `RobotArmControl [FB1]`, `RobotArmControl_DB [DB5]`, `ModbusData [DB3]`, `Holding Register [DB2]`, `Main [OB1]` y `Startup [OB100]`. No crear otros bloques ni renombrar los existentes. No se ha modificado tu SCL.

**Advertencia de compatibilidad:** el archivo SCL nuevo declara otros nombres (`FB_FT511938_Real`, `DB_FT511938_Modbus`, `Image`, `HR`). Las tablas siguientes describen cómo deben quedar los **bloques existentes**, pero **no bastan para ejecutar sin adaptar las referencias del nuevo SCL**. Sin esa adaptación explícita el programa no compilará con tus nombres originales. Las direcciones físicas `%I` y `%Q` no se deducen de las capturas: no se inventan.

## 1. Modificar `RobotHolding [DB4]` — pantalla 2

En la sección `Static`, **conservar la fila `Struct`** de tipo `Struct`. Sustituir **todos sus campos hijos** por las filas de esta tabla, **en este orden**, sin añadir `Image.` ni renombrar `Struct`. El valor mostrado es `Start value` en TIA. En registros calculados es únicamente el valor de arranque, no un permiso de seguridad.

| Name (dentro de `Struct`) | Data type | Start value | Holding register | DB byte offset |
|---|---|---:|---|---:|
| `Cmd` | `Int` | `0` | HR0 | 0 |
| `Enable` | `UInt` | `0` | HR1 | 2 |
| `JogAxis` | `Int` | `0` | HR2 | 4 |
| `JogDirection` | `Int` | `0` | HR3 | 6 |
| `JogEnable` | `UInt` | `0` | HR4 | 8 |
| `HeartbeatSequence` | `UInt` | `0` | HR5 | 10 |
| `ManualTarget1` | `Real` | `0.0` | HR6–HR7 | 12 |
| `ManualTarget2` | `Real` | `0.0` | HR8–HR9 | 16 |
| `ManualTarget3` | `Real` | `0.0` | HR10–HR11 | 20 |
| `ManualTarget4` | `Real` | `0.0` | HR12–HR13 | 24 |
| `SensorPolicy` | `UInt` | `0` | HR14 | 28 |
| `SensorValid` | `UInt` | `0` | HR15 | 30 |
| `SensorQualityBits` | `UInt` | `0` | HR16 | 32 |
| `SensorAgeMs` | `UInt` | `0` | HR17 | 34 |
| `TemperatureCx100` | `Int` | `0` | HR18 | 36 |
| `HumidityRHx100` | `UInt` | `0` | HR19 | 38 |
| `GyroDpsx100` | `UInt` | `0` | HR20 | 40 |
| `SafetyOK` | `UInt` | `0` | HR21 | 42 |
| `DrivesReady` | `UInt` | `0` | HR22 | 44 |
| `CommFresh` | `UInt` | `0` | HR23 | 46 |
| `SensorOK` | `UInt` | `0` | HR24 | 48 |
| `HomedMask` | `UInt` | `0` | HR25 | 50 |
| `MinLimitMask` | `UInt` | `0` | HR26 | 52 |
| `MaxLimitMask` | `UInt` | `0` | HR27 | 54 |
| `WiringVerified` | `UInt` | `0` | HR28 | 56 |
| `PhysicalOutputEnable` | `UInt` | `0` | HR29 | 58 |
| `Pos1` | `Real` | `0.0` | HR30–HR31 | 60 |
| `Pos2` | `Real` | `0.0` | HR32–HR33 | 64 |
| `Pos3` | `Real` | `0.0` | HR34–HR35 | 68 |
| `Pos4` | `Real` | `0.0` | HR36–HR37 | 72 |
| `Target1` | `Real` | `0.0` | HR38–HR39 | 76 |
| `Target2` | `Real` | `0.0` | HR40–HR41 | 80 |
| `Target3` | `Real` | `0.0` | HR42–HR43 | 84 |
| `Target4` | `Real` | `0.0` | HR44–HR45 | 88 |
| `Status` | `UInt` | `0` | HR46 | 92 |
| `ActiveMode` | `UInt` | `0` | HR47 | 94 |
| `ActiveStep` | `UInt` | `0` | HR48 | 96 |
| `AlarmCode` | `UInt` | `0` | HR49 | 98 |
| `Done` | `UInt` | `0` | HR50 | 100 |
| `IoTAlarmCode` | `UInt` | `0` | HR51 | 102 |
| `ConditionState` | `UInt` | `0` | HR52 | 104 |
| `SpeedPermille` | `UInt` | `0` | HR53 | 106 |
| `CmdQ1toQ8Mask` | `UInt` | `0` | HR54 | 108 |
| `RunMask` | `UInt` | `0` | HR55 | 110 |
| `DirectionMask` | `UInt` | `0` | HR56 | 112 |
| `HeartbeatEcho` | `UInt` | `0` | HR57 | 114 |
| `SimulationMode` | `UInt` | `0` | HR58 | 116 |
| `StartupReady` | `UInt` | `0` | HR59 | 118 |
| `DoneCounter` | `UInt` | `0` | HR60 | 120 |

**Pegado de columnas Name / Data type / Start value** (seleccionar la primera celda de la primera fila hija de `Struct`; la aceptación de pegado tabulado depende de la versión de TIA Portal):

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

**DB4:** desactivar `Optimized block access`, comprobar que `Struct.Cmd` tenga offset 0 y `Struct.DoneCounter` offset 120. Total de la estructura: **122 bytes** (61 registros HR0–HR60). Los campos `Real` ocupan 4 bytes. Si la tabla deja huecos o desplazamientos distintos, no utilizar el mapa.

**Borrar del interior de `Struct`:** `Command`, `ElapsedMsOut`, `J1Raw`, `J2Raw`, `J3Raw`, `J4Raw`, `J5Raw`, `J6Raw`, `ProgramSignature` (si aparece) y todos los campos anteriores que no estén en la lista nueva. `Status`, `ActiveStep`, `AlarmCode`, `ConditionState`, `SpeedPermille`, `TemperatureCx100`, `HumidityRHx100`, `GyroDpsx100`, `SensorAgeMs`, `SensorValid`, `SensorQualityBits`, `SensorPolicy` se conservan como nombres, pero **se colocan en el orden y posición indicados en la tabla**. Esto cambia el mapa anterior y exige adaptar clientes Modbus.

### Registros de control y dirección

- `Cmd`: 0 reposo; 1 secuencia automática; 2 desplazamiento a referencia programada (no homing); 3 JOG; 4 objetivo manual.
- `Enable`, `JogEnable`: inicial 0, no activarlos hasta completar la puesta en marcha.
- `ManualTarget1..4`: valores `REAL` distribuidos en dos HR cada uno; el cliente Modbus debe respetar palabra alta primero.
- `SafetyOK`, `DrivesReady`, `WiringVerified`, `PhysicalOutputEnable`, `Pos1..4` y máscaras de finales de carrera/homing: **salidas informativas del controlador calculadas desde I/O reales**, no permisos que deban forzarse por Modbus.

## 2. Modificar `RobotArmControl [FB1]` — pantalla 3

Conservar el bloque `RobotArmControl [FB1]`. Las nuevas secciones `Input`, `InOut`, `Output` y `Static` corresponden a las declaraciones del **nuevo algoritmo** (no a las del FB anterior). La columna siguiente muestra valores de inicio sugeridos seguros para una instancia sin señales energizadas; las entradas de hardware se conectan en OB1, no se dejan constantes TRUE.

### Input: añadir o sustituir filas

| Name | Data type | Default value |
|---|---|---|
| `SafetyOK` | `Bool` | `FALSE` |
| `DrivesReady` | `Bool` | `FALSE` |
| `WiringVerified` | `Bool` | `FALSE` |
| `PhysicalOutputEnable` | `Bool` | `FALSE` |
| `FeedbackValid` | `Bool` | `FALSE` |
| `Homed` | `Array[1..4] of Bool` | `FALSE` (elementos) |
| `MinLimit` | `Array[1..4] of Bool` | `FALSE` (elementos) |
| `MaxLimit` | `Array[1..4] of Bool` | `FALSE` (elementos) |
| `PosMeasured` | `Array[1..4] of Real` | `0.0` (elementos) |

### InOut
| Name | Data type | Default value |
|---|---|---|
| `HR` | `UDT_FT511938_HR0_60` en el SCL original | Sin valor: se enlaza a DB4 (`RobotHolding.Struct`) |

**Incompatibilidad de interfaz:** la tabla anterior es la interfaz que exige el código nuevo. Tu `RobotHolding.Struct` es un `Struct` declarado manualmente y no tiene automáticamente el tipo `UDT_FT511938_HR0_60`. Para reutilizar DB4 sin crear un UDT se tendría que cambiar el parámetro `HR` y las referencias de acceso del SCL. **No se debe pegar literalmente ese tipo como si ya existiera**, porque no existe entre los bloques de tus capturas. Esto queda pendiente de tu autorización para adaptar el SCL.

### Output
| Name | Data type | Default value |
|---|---|---|
| `CmdQ1toQ8` | `Array[1..8] of Bool` | `FALSE` (elementos) |
| `Run` | `Array[1..4] of Bool` | `FALSE` (elementos) |
| `DirectionPositive` | `Array[1..4] of Bool` | `FALSE` (elementos) |

### Static: variables exactas de la nueva lógica

| Name | Data type | Default value |
|---|---|---|
| `ModeState` | `Int` | `0` |
| `LastCmd` | `Int` | `0` |
| `Step` | `Int` | `0` |
| `ManualPhase` | `Int` | `0` |
| `Fault` | `Int` | `0` |
| `ActiveAxis` | `Int` | `0` |
| `i` | `Int` | `0` |
| `q` | `Int` | `0` |
| `Delta` | `Real` | `0.0` |
| `Target` | `Array[1..4] of Real` | Inicialización por defecto (no inventar posiciones/homing) |
| `CapturedTarget` | `Array[1..4] of Real` | Inicialización por defecto (no inventar posiciones/homing) |
| `MinPos` | `Array[1..4] of Real` | Inicialización por defecto (no inventar posiciones/homing) |
| `MaxPos` | `Array[1..4] of Real` | Inicialización por defecto (no inventar posiciones/homing) |
| `Tol` | `Array[1..4] of Real` | Inicialización por defecto (no inventar posiciones/homing) |
| `AllHomed` | `Bool` | `FALSE` |
| `PosValid` | `Bool` | `FALSE` |
| `PhysicalPermitted` | `Bool` | `FALSE` |
| `ManualPermitted` | `Bool` | `FALSE` |
| `AutoPermitted` | `Bool` | `FALSE` |
| `AutoMotionAllowed` | `Bool` | `FALSE` |
| `Permitted` | `Bool` | `FALSE` |
| `MotionPresent` | `Bool` | `FALSE` |
| `IoTBlock` | `Bool` | `FALSE` |
| `IoTDegraded` | `Bool` | `FALSE` |
| `AnyMoving` | `Bool` | `FALSE` |
| `AtTarget` | `Bool` | `FALSE` |
| `ManualTargetValid` | `Bool` | `FALSE` |
| `ManualRequiresSafeHeight` | `Bool` | `FALSE` |
| `ManualBaseReady` | `Bool` | `FALSE` |
| `ManualHeightReady` | `Bool` | `FALSE` |
| `ManualExtensionReady` | `Bool` | `FALSE` |
| `ManualGripperReady` | `Bool` | `FALSE` |
| `OutputGate` | `Bool` | `FALSE` |
| `HeartbeatChanged` | `Bool` | `FALSE` |
| `HeartbeatSeen` | `Bool` | `FALSE` |
| `LastHeartbeat` | `UInt` | `UINT#0` |
| `TemperatureC` | `Real` | `0.0` |
| `HumidityRH` | `Real` | `0.0` |
| `GyroDps` | `Real` | `0.0` |
| `SettleEnable` | `Bool` | `FALSE` |
| `TimeoutEnable` | `Bool` | `FALSE` |
| `TimeoutReset` | `Bool` | `FALSE` |
| `MotionKey` | `DInt` | `0` |
| `LastMotionKey` | `DInt` | `DINT#-1` |
| `MotionIdleTimer` | `TON` | (instancia TON, sin valor manual) |
| `HeartbeatWatchdog` | `TON` | (instancia TON, sin valor manual) |
| `SettleTimer` | `TON` | (instancia TON, sin valor manual) |
| `MotionTimeout` | `TON` | (instancia TON, sin valor manual) |

**Eliminar del FB1 las variables antiguas** no presentes en las tablas nuevas (`TimerEnabled`, `ResetTimer`, `ElapsedMs`, `SegmentStartMs`, `SegmentDurationMs`, `P`, `MotionScale`, `J1Deg` a `J6Deg`, `TargetJ1` a `TargetJ6`, `DegToRadScaled`, `CycleTimer`, etc.) **solo al sustituir realmente el cuerpo del algoritmo y tras guardar una copia del proyecto**. No borrar variables del FB actual mientras el cuerpo antiguo las utilice.

**`Temp` y `Constant`:** el SCL nuevo no declara variables en estas secciones. Déjalas vacías salvo que existan otras dependencias propias del proyecto.

## 3. `RobotArmControl_DB [DB5]` — pantalla 1

Este es el **DB de instancia** de `RobotArmControl [FB1]`: **no pegues campos a mano** en él. Una vez actualizado y compilado FB1, el DB5 reflejará automáticamente sus entradas, salidas, InOut y Static. Conserva el nombre `RobotArmControl_DB` y número DB5. Comprueba que aparezcan los nombres de Static de la sección 2. Si el entorno exige actualizar el DB de instancia, hazlo desde la compilación/actualización de llamada de FB1, no añadiendo filas manuales.

## 4. `Main [OB1]` — bloque existente

Mantener el mismo OB1; necesita una llamada cíclica a **`RobotArmControl` (FB1)** usando **`RobotArmControl_DB` (DB5)**. Asociar el InOut `HR` a `RobotHolding.Struct` **una vez resuelta la compatibilidad de tipos**. Los parámetros `SafetyOK`, `DrivesReady`, `WiringVerified`, `PhysicalOutputEnable`, `FeedbackValid`, `Homed[1..4]`, `MinLimit[1..4]`, `MaxLimit[1..4]`, `PosMeasured[1..4]` exigen tags del hardware concreto. No asignarles `TRUE` ficticios ni valores de posición del objetivo. Los outputs `CmdQ1toQ8[1..8]`, `Run[1..4]` y `DirectionPositive[1..4]` **no deben conectarse a salidas `%Q` hasta contrastar los bornes y características eléctricas**.

## 5. `ModbusData [DB3]` y `Holding Register [DB2]` — bloques existentes

Las capturas solo muestran **sus nombres**, no su estructura interna ni la red de `MB_SERVER`. **No hay información suficiente para decir qué filas modificar en DB2 o DB3**. Mantén sus variables actuales hasta comprobar qué DB es la instancia de `MB_SERVER`, qué parámetro `MB_HOLD_REG` está cableado y qué área de memoria se expone. La intención del nuevo mapa es exponer `RobotHolding.Struct` desde byte 0 hasta byte 121. Eso **no prueba** que el MB_SERVER de tu proyecto acepte directamente el struct ni que ya lo tengas enlazado.

## 6. `Startup [OB100]` — bloque existente

No hay código de OB100 en las capturas. No se puede ordenar qué líneas cambiar. En la nueva lógica el arranque seguro requiere al menos `Cmd=0`, `Enable=0`, `JogEnable=0` y **salidas desenergizadas**; revisa que OB100 no reactive un comando anterior. No establecer permisos físicos desde valores por defecto.

## 7. Secuencia de edición exacta

1. Guardar una copia del proyecto TIA existente y dejar desconectada la potencia de los accionamientos.
2. Abrir `RobotHolding [DB4]` → `Static` → `Struct` → reemplazar hijos con las 49 filas de la sección 1, orden exacto, comprobando 61 HR.
3. Abrir `RobotArmControl [FB1]` → preparar `Input`, `InOut`, `Output`, `Static` como sección 2. **No compilar como listo todavía:** el nuevo SCL no usa esos nombres de bloques y necesita adaptación para reutilizarlos.
4. Conservar `RobotArmControl_DB [DB5]`; dejar que se actualice a partir de FB1.
5. Revisar `Main [OB1]`, `ModbusData [DB3]`, `Holding Register [DB2]`, `Startup [OB100]` conforme a secciones 4–6.
6. Confirmar direcciones físicas, secuencia eléctrica segura, lógica de homing, y compatibilidad del `MB_SERVER`. Compilar y probar sin energizar motores.

**Punto que bloquea el copiar/pegar completo y la compilación:** el nuevo SCL, tal como está adjuntado, **no es directamente compatible** con los nombres y el `Struct` anónimo de tus bloques antiguos. Para que funcione exactamente con `RobotHolding [DB4]` y `RobotArmControl [FB1]`, hace falta autorizar una adaptación puntual de referencias en el SCL; no se ha realizado aquí.
