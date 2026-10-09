# MANUAL DE REVISIÓN Y PRECOMISIONADO — FT 511938 + SIEMENS S7-1200

**Revisión 3 | 8 octubre 2026 | DISEÑO NO AUTORIZADO PARA ENERGIZACIÓN**

**Alcance:** fischertechnik **3D-Robot TX 24 V, Art. 511938**, Siemens S7-1200 fotografiado (aparentemente **CPU 1214C AC/DC/Relay**) y FORGE-DT. Se entrega **UN SOLO BLOQUE** `FB_FT511938_UNICO_REVISION_3.scl`; no se requieren dos bloques. El bloque está preparado para compilación/revisión, **no ha sido compilado en TIA Portal, ni probado en PLC ni máquina**.

> **ALTO ANTES DE CONECTAR:** la fuente a 24 V del robot no equivale a alimentar la CPU Siemens a 24 V. En la foto, la etiqueta superior de la CPU indica **120–240 VAC** para L1/N, y ofrece una alimentación de sensores 24 V DC con potencia limitada. El cableado de fuerza de la CPU y del robot debe dimensionarlo y verificarlo un técnico cualificado. Nunca unir Q0.x a la placa basándose en las imágenes antiguas generadas.

## 1. Evidencia disponible y grado de certeza

| Dato | Fuente | Estado |
|---|---|---|
| Robot FT 511938, alimentación actuadores/sensores 24 V DC | Datasheet fabricante pp. 1–3 | Confirmado documentalmente |
| Conector de control **26 posiciones** | Datasheet p. 3 | Confirmado |
| Terminales 1–22: alimentación, sensores y motores | Datasheet pp. 2–3 | Confirmado |
| 23–24 sin función; 25–26 GND en conector de 26 vías | Datasheet p. 3 | Confirmado para conector del fabricante; acceso exterior por verificar |
| CPU aparente 1214C AC/DC/Relay, con grupos de relés 1L y 2L | Foto y manual Siemens | Tipo probable; referencia 6ES7 aún sin leer |
| Salidas libres de la CPU | Foto con salidas **ya cableadas** | NO confirmado; deben revisarse conflictos con instalación existente |
| Interfaz eléctrica exacta de Q1–Q8 del robot, corriente admisible, polaridad, protección de relés | No detallada en el documento FT recibido | **No demostrada; prohibido suponer** |
| Disponibilidad y conexión de seguridad, E-stop, alimentación protegida y límites de ambos extremos | Sin documentación eléctrica de conjunto | **No verificado** |

## 2. Correspondencia oficial del conector fischertechnik

**Señales I, B y Q son nomenclatura FT, no direcciones `%I`/`%Q` del Siemens.** En esta edición el fabricante llama M1 a la pinza, M2 al brazo, M3 al vertical y M4 al giro; el modelo 3D `j1..j4` comienza por el giro. 

| Terminal FT | Señal FT | Función documentada | Dirección S7 PROPUESTA, no cable validado |
|---|---|---|---|
| 1 | +24 V | Alimentación actuadores | Fuente 24 V protegida y verificada |
| 2 | +24 V | Alimentación sensores | Fuente 24 V protegida y verificada |
| 3 | 0 V | Retorno alimentación | 0 V según circuito de referencia |
| 4 | 0 V | Retorno alimentación | 0 V según circuito de referencia |
| 5 | I1 | Referencia pinza | `%I0.0` (candidata) |
| 6 | I2 | Impulsos pinza | `%I0.1` (candidata) |
| 7 | I3 | Referencia brazo | `%I0.2` (candidata) |
| 8 | I4 | Impulsos brazo | `%I0.3` (candidata) |
| 9 | I5 | Referencia vertical | `%I0.4` (candidata) |
| 10 | I6 | Referencia giro | `%I0.5` (candidata) |
| 11 | B1 | Encoder vertical canal A | Entrada HSC por CONFIGURAR |
| 12 | B2 | Encoder vertical canal B | Entrada HSC por CONFIGURAR |
| 13 | B3 | Encoder giro canal A | Entrada HSC por CONFIGURAR |
| 14 | B4 | Encoder giro canal B | Entrada HSC por CONFIGURAR |
| 15 | Q1 | Abrir pinza | `%Q0.0` candidata |
| 16 | Q2 | Cerrar pinza | `%Q0.1` candidata |
| 17 | Q3 | Brazo hacia delante | `%Q0.2` candidata |
| 18 | Q4 | Brazo hacia atrás | `%Q0.3` candidata |
| 19 | Q5 | Vertical abajo | `%Q0.4` candidata |
| 20 | Q6 | Vertical arriba | `%Q0.5` candidata |
| 21 | Q7 | Giro derecha | `%Q0.6` candidata |
| 22 | Q8 | Giro izquierda | `%Q0.7` candidata |
| 23–24 | — | Sin función indicada | **No conectar** |
| 25–26 | GND | Tierra/retorno del conector de 26 polos | Verificar conector y necesidad real; no suponer |

**Corrección clave:** los diagramas anteriores representaban «Q0.0 → terminal 1» y «+24V → 23». **Ambos son falsos** según el datasheet. Los diagramas anteriores no se incluyen como conexiones válidas.

## 3. Vista física del Siemens: distinguir bornes y memoria

La fotografía muestra una CPU de formato 1214C **AC/DC/relé**. **X10 (arriba)** incluye `L1, N`, tierra funcional, `L+, M`, `1M` y entradas digitales; **X11** aloja analógicas; **X12 (abajo)** contiene salidas de relé **con comunes 1L y 2L**. En el manual de CPU 1214C **6ES7214-1BG40-0XB0**, X12 se especifica:

| Pin físico X12 (si la referencia coincide) | Señal | Nota |
|---|---|---|
| 1 | 1L | Común de grupo de contactos |
| 2–6 | DQ a.0 a DQ a.4 | Salidas `%Q0.0` a `%Q0.4` |
| 7 | 2L | Común de segundo grupo |
| 8–10 | DQ a.5 a DQ a.7 | Salidas `%Q0.5` a `%Q0.7` |
| 11–12 | DQ b.0 a DQ b.1 | Salidas `%Q1.0` a `%Q1.1` |

La imagen muestra cables existentes y etiquetas **1L/2L**. No sabemos qué tensión atraviesa esos contactos. **No debe conectarse al robot ninguna de esas salidas hasta identificar dónde van actualmente y medirlas sin tensión y luego mediante procedimiento seguro.** `1L/2L` son comunes de contactos secos; no son equivalentes a `L+` de los sensores. El 24 V auxiliar de sensores del Siemens no se considera fuente de potencia de motores.

**Salida por relé**: frecuencia máxima de conmutación Siemens indicada **1 Hz** para esta familia; no PWM; evitar reversiones rápidas; evaluar desgaste, corrientes de irrupción, supresión de inductivos y necesidad de interfaz apropiada. Los dos encoders B1/B2 y B3/B4 son señales 0/24 V push-pull hasta 1 kHz, máx. 10 mA conforme a la ficha de motor encoder FT 144643. Confirmar compatibilidad de entradas rápidas HSC reales y ocupación de canales en TIA antes de asignar `%I`.

## 4. Dos ilustraciones correctas (NO plano de potencia)

### 4.1. Vista del PLC real: salida X12 en la cara frontal inferior

![](/mnt/data/WhatsApp Image 2026-10-07 at 14.54.06 (4)(1).jpeg)

### 4.2. Vista de la placa real: bornera numerada 1–24

![](/mnt/data/WhatsApp Image 2026-10-07 at 14.52.33(1).jpeg)

### 4.3. Pinout del fabricante, única fuente de numeración válida

![](/mnt/data/robot_control/datasheet_page3.png)

**El conector oficial de 26 polos y la regleta física visible 1–24 no deben tratarse como idénticos sin verificar continuidad y numeración.** Si hay una placa adaptadora, el conexionado de la regleta exterior requiere comprobación de continuidad contra el conector oficial.

## 5. Correspondencia física y lógica del único SCL

| Eje visor | Movimiento | Señales FT | Salida booleana del FB | Sensores FT |
|---|---|---|---|---|
| `j1` | Giro CCW / CW, rango provisional -171..171° | Q8 izquierda / Q7 derecha | `CmdQ1toQ8[8]`/`[7]` | I6 referencia, B3/B4 cuadratura |
| `j2` | Altura, 130..360 mm | Q6 subir / Q5 bajar | `[6]`/`[5]` | I5 referencia, B1/B2 cuadratura |
| `j3` | Extensión 0..180 mm | Q3 avance / Q4 recogida | `[3]`/`[4]` | I3 referencia, I4 pulsos |
| `j4` | Apertura 12..70 mm | Q1 abrir / Q2 cerrar | `[1]`/`[2]` | I1 referencia, I2 pulsos |

**Valores geométricos y velocidades (20°/s, 15 mm/s, 10 mm/s) provienen de la especificación del visor, NO del datasheet FT.** No son parámetros calibrados ni topes físicos certificados. No realizar homing por simple temporización. La posición de la herramienta se obtiene a partir de referencias y contadores calibrados; sin ellos la rutina GOTO debe permanecer inhibida.

## 6. Modos de funcionamiento y registros

**Comandos lógicos:** `Cmd=0` STOP; `1` AUTO (9 tramos con apertura inicial separada); `2` RESET; `3` JOG mantenido; `4` GOTO por posición. `MotionIdleTimer`, `TemperatureCx100`, `HumidityRHx100`, `GyroDpsx100`, `SensorAgeMs`, `SensorQualityBits`, `SensorValid`, `SensorPolicy` conservan supervisión IoT; degradación IoT **bloquea** motores ON/OFF (550 permille solo diagnóstico, no controla la velocidad de un relé). Los umbrales de temperatura/humedad/gyro vienen del programa aportado por el usuario, no del fabricante FT.

| Variable SCL | Tipo | Función | Fuente |
|---|---|---|---|
| `Cmd` | Int | modo 0–4 | Modbus/`RobotHolding` mediante capa de interfaz |
| `JogAxis` | Int | eje j1..j4 | HMI/FORGE-DT |
| `JogDirection` | Int | -1/+1 | HMI/FORGE-DT |
| `JogEnable` | Bool | pulsación mantenida, protegida por watchdog | HMI/FORGE-DT |
| `ManualTarget[1..4]` | Array Real | coordenadas en °, mm, mm, mm | HMI/FORGE-DT |
| `Pos[1..4]` | Array Real | posición REAL calculada desde medición | HSC/pulsos + homing |
| `Homed[1..4]` | Array Bool | eje referenciado físicamente | rutina de homing verificada, no incluida |
| `CommFresh` | Bool | watchdog externo de comunicación | contador heartbeat nuevo, NO flag constante |
| `WiringVerified` | Bool | control de puesta en marcha | debe permanecer FALSE hasta documentación y ensayos |
| `PhysicalOutputEnable` | Bool | habilitación formal de salida | debe permanecer FALSE hasta procedimiento de validación |
| `SafetyOK`, `DrivesReady` | Bool | retorno de permisos externos | **no** reemplazan E-stop de hardware |
| `CmdQ1toQ8[1..8]` | Array Bool | salida lógica hacia ocho mandos FT | no conectar sin circuito validado |

**Registros Modbus:** el datasheet FT no documenta ninguna dirección Modbus; las direcciones y offsets del `RobotHolding` existente dependen del `MB_SERVER` y del DB real. **No es posible proporcionar números 40001, 40002, etc. verificados sin `RobotHolding.Struct`, estructura completa y configuración `MB_SERVER`**. Una variable en SCL no equivale automáticamente a un registro Modbus ni al borne 15 del robot. Reservar los tags simbólicos anteriores, documentar su `offset` definitivo una vez proporcionado el DB y revisar tipo `INT`, `UINT`, `REAL`, byte order y endianness.

## 7. Comportamiento seguro pretendido y límites del código

El único FB inicia todos los mandos en FALSE cada ciclo; solo genera Q1..Q8 si hay `Enable`, `SafetyOK`, `DrivesReady`, `SensorOK`, `CommFresh`, todos los `Homed`, posición plausible, política IoT válida y además **WiringVerified = TRUE** y **PhysicalOutputEnable = TRUE**. Deben permanecer FALSE en proyecto real hasta concluir pruebas.

- JOG mantiene movimiento solo mientras `JogEnable` y watchdog están activos. Si el operador abandona la pantalla o cae Ethernet, el watchdog debe desactivar `CommFresh` en plazo conocido y medido.
- AUTO solo inicia desde Home medido, con 9 pasos de objetivos; paso de apertura de pinza separado. No equivale a ejecución apta para producción.
- STOP lógico envía cero, pero el STOP de CPU, un cable cortado o relé pegado **pueden necesitar parada hardware independiente**. Revisar estado de sustitución de salidas en TIA.
- Inhibir inversiones rápidas y conmutación repetida. El FB NO tiene enclavamiento eléctrico de potencia ni paro seguro. Confirmar relés de placa FT y posible necesidad de driver/contactor intermedio.
- Una condición IoT crítica bloquea movimiento; no sustituye finales de carrera o protección del motor.
- Tiempos T#30s por tramo son topes de programación **no validados**. Calibrar par motor, corriente, fin de carrera y carrera libre antes de poner carga.

## 8. Protocolo de revisión obligatorio ANTES de energizar

1. Leer de la carcasa CPU **referencia 6ES7... completa**, firmware y configuración de hardware de TIA. Comparar con manual Siemens específico.
2. Con alimentación desconectada y ausencia de tensión verificada por personal cualificado, seguir cables ya existentes X12 (1L, 2L, Q0.x), no reasignar salidas ocupadas.
3. Comprobar si regleta 1–24 de la PCB corresponde realmente por continuidad a los 24 primeros pines del conector de 26 posiciones. Identificar pines 25–26.
4. Obtener el circuito eléctrico o ficha de la placa verde, nivel/polaridad y corriente de entradas Q1–Q8, así como fusibles, aislamiento y protección de contactos. **No inyectar 24 V por inferencia**.
5. Verificar final de carrera I1,I3,I5,I6, impulsos I2,I4, cuadratura B1..B4, y entradas Siemens compatibles con señales efectivas. Revisar dos HSC de cuadratura sin conflicto de canales.
6. Implementar parada de emergencia cableada adecuada, enclavamiento físico de órdenes contrarias, desconexión segura de energía y límites adicionales; evaluar atrapamientos y cableado móvil.
7. Probar primero en simulación con `WiringVerified=FALSE` y `PhysicalOutputEnable=FALSE` (todas `CmdQ1toQ8` deben permanecer cero), comprobar estados, alarmas y watchdog.
8. Solo tras aprobar la revisión eléctrica y seguridad, documentar el procedimiento de comisionado y probar movimiento de un eje bajo supervisión, a velocidad/carrera controladas y sin carga, sin puentear protecciones.

## 9. Pendientes que impiden declarar el equipo seguro

- Referencia Siemens legible `6ES7...` y proyecto TIA real con ocupación de X10/X11/X12, configuración HSC, variables `%I/%Q`, funciones de parada y límites de corriente.
- Esquema eléctrico de PCB verde y características de entrada Q1–Q8; una tabla de bornes del fabricante por sí sola no demuestra su aptitud para conexión directa a los relés Siemens.
- `RobotHolding` y `MB_SERVER` reales para mapa de registros Modbus y enlace de este FB con el código existente.
- Medida experimental de carrera física, contadores por unidad, tolerancia, velocidades, sobrecarrera e inercia.
- Compilación TIA, simulación, pruebas de fallos y validación por personal responsable.

## 10. Referencias

1. fischertechnik, *511938 3D-Robot TX 24V*, ficha facilitada, pp. 1–3 y ficha encoder 144643 p. 4.
2. Siemens, *S7-1200 CPU 1214C wiring diagrams* (CPU AC/DC/Relay 6ES7214-1BG40-0XB0), manual oficial: https://docs.tia.siemens.cloud/r/simatic_s7_1200_manual_collection_enus_20/technical-specifications/cpu-1214c/cpu-1214c-wiring-diagrams
3. Siemens, *S7-1200 Digital inputs and outputs*, límites de relés: https://docs.tia.siemens.cloud/r/simatic_s7_1200_manual_collection_eses_20/technical-specifications/cpu-1214c/digital-inputs-and-outputs
