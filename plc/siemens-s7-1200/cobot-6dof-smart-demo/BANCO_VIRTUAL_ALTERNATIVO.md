# Banco virtual alternativo en un S7 real

## AUTO con IoT real

La alternativa ya no fuerza HR14 ni fabrica telemetria HR15..20.
Actualizar en TIA el cuerpo con RobotArmControl_VIRTUAL_PEGAR_EN_FB.txt,
compilar y cargar antes de probar estas politicas.

- HR14=0: AUTO se permite con giroscopio menor de 3 grados/s durante 2 segundos;
  se bloquea al detectar movimiento.
- HR14=1: AUTO se permite solo con giroscopio mayor o igual a 3 grados/s.
- Ambas politicas requieren IoT valido, bit de giroscopio y edad <=2500 ms;
  los umbrales ambientales y de vibracion originales siguen bloqueando AUTO.
- La perdida de permiso IoT pausa AUTO, sin reiniciar su paso; al volver el
  permiso continua. STOP/HOLD cancela la secuencia.
- Manual no depende del IoT. Las posiciones siguen siendo virtuales y las
  ocho salidas CmdQ1toQ8 permanecen FALSE.

En la plataforma V2 seleccionar desconectado Banco virtual en S7 y conectar.
Los botones Auto - IoT sin movimiento / en movimiento seleccionan HR14 e
inician AUTO en este banco. No usar Cmd5 ni habilitar salidas fisicas.
Sin telemetria real valida AUTO debe permanecer bloqueado.

## Actualizacion: interfaz identica a produccion

La fuente RobotArmVirtualCommissioning.scl ha sido reconstruida. Las instrucciones
del wrapper anterior mas abajo son historicas y NO se deben usar: ya no existen
BenchEnabled, Controller, FreezeFeedback ni VirtualPosition.

La nueva alternativa declara exactamente Input/Output/Static del RobotArmControl
original. Para un FB existente, usar RobotArmControl_VIRTUAL_PEGAR_EN_FB.txt como
cuerpo de instrucciones, sin BEGIN/END_FUNCTION_BLOCK ni declaraciones.
Guardar antes el cuerpo de produccion y mantener una copia del proyecto TIA.
Para conservar ambos bloques en TIA, importar la fuente alternativa como un FB
distinto, crear su instancia y copiar la misma llamada de produccion cambiando
solo el nombre de instancia. No ejecutar las dos llamadas simultaneamente.

No se añaden registros ni variables. MinPos se reutiliza como estado de posicion
virtual SOLO en esta alternativa; sus limites inferiores pasan a constantes.
Cada cambio real de HR5 avanza los ejes con orden activa: base 5 grados, altura
10 mm, extension 10 mm, pinza 3 unidades por cambio. La velocidad depende de la
cadencia de heartbeat. Los objetivos manuales conservan su significado original.
HR58=1 y HR29=0 identifican simulacion; HR54 contiene decisiones virtuales y las
ocho salidas CmdQ1toQ8 del FB se fuerzan a FALSE al final del ciclo.
Run/DirectionPositive son datos logicos: tampoco deben conectarse a hardware.

Las entradas originales se conservan por compatibilidad, pero el banco no depende
de sensores fisicos: referencia y feedback son sinteticos, al igual que IoT.
El watchdog HR5/HR57 sigue real; STOP y fallo detienen las decisiones virtuales.
Cmd5 no se usa en esta alternativa. La compatibilidad del dashboard remoto con
HR58=1/HR29=0 sigue pendiente; no usar el perfil fisico de produccion como bypass.

No compilado con TIA ni validado en CPU real. Esta version no demuestra salidas
electricas ni autoriza a conectar motores. Las secciones siguientes describen
la version anterior y se conservan solo como referencia historica.

Este banco ejecuta la logica existente `RobotArmControl` con posiciones virtuales
calculadas dentro del PLC. No requiere motores, sensores fisicos ni IoT conectado.
El programa de produccion no se borra ni se modifica. El mapa `RobotHolding.Struct`
HR0..60 y sus variables permanecen iguales. El nuevo FB tiene su propia instancia
y variables internas; no hay que reasignar los registros de la plataforma.

## Alcance

- STOP, AUTO, HOME, JOG y posicion manual usan la logica original, no una copia.
- La plataforma manda y lee los mismos registros. El heartbeat sigue siendo real:
  debe cambiar HR5 antes de 2500 ms; HR57 devuelve su eco y HR23 indica vigencia.
- `SimulationMode=1` identifica inequívocamente el ensayo. HR29 permanece a cero.
- HR54 muestra ordenes Q virtuales, NO tension medida en bornes.
- Las posiciones virtuales cambian lentamente segun Run y Direction del controlador.
- Los rangos son los del ejemplo anterior, exclusivamente virtuales. No son
  margenes mecanicos autorizados para un robot real.

## Cargar sin sustituir el programa anterior

1. Guardar una copia del proyecto TIA. Mantener los actuadores aislados.
2. Conservar `RobotArmControl`, su DB de produccion, `RobotHolding` y `MB_SERVER`.
3. Importar SOLO `RobotArmVirtualCommissioning.scl` como fuente externa y generar
   su FB. No pegar esta fuente completa dentro del editor de instrucciones de FB1.
4. Crear una llamada del nuevo FB en OB1 y su DB de instancia
   `RobotArmVirtualCommissioning_DB` mediante TIA.
5. Durante este ensayo, deshabilitar la llamada anterior a `RobotArmControl_DB` en
   OB1. No borrar su bloque. Solo un controlador puede escribir `RobotHolding`.
6. No conectar `VirtualQ1toQ8` a `%Q`, periferia, salidas de hardware, motores ni
   al bloque que copia ordenes a salidas. Revisar otras redes que pudieran usar
   HR54 o las ordenes del antiguo DB para activar hardware.
7. Conservar la llamada existente `MB_SERVER` exponiendo `RobotHolding.Struct`.
8. Compilar y revisar los mensajes de carga, especialmente cambios de instancia.

Ejemplo de llamada, despues de crear el DB de instancia con TIA:

```scl
"RobotArmVirtualCommissioning_DB"(
    BenchEnabled := TRUE,
    InjectHealthyIoT := TRUE,
    FreezeFeedback := FALSE,
    FeedbackValid := TRUE,
    Homed := [TRUE, TRUE, TRUE, TRUE],
    MinLimit := [FALSE, FALSE, FALSE, FALSE],
    MaxLimit := [FALSE, FALSE, FALSE, FALSE]);
```

No se incluye OB1 completo para evitar sobrescribir la configuracion MB_SERVER
especifica de la instalacion. Si el editor no acepta literales de arrays, asignar
los elementos desde una tabla de pruebas local al proyecto TIA.

## Plataforma

Seleccionar el perfil **OpenPLC FT511938 HR0..60**, pero indicar la IP y puerto
del **S7 real de ensayo**, no localhost. Este perfil admite el contrato con
`SimulationMode=1`; su nombre indica el contrato de simulacion, no el hardware
al que se conecta. Confirmar el endpoint antes de conectar. No usar el perfil
legacy QW90 ni pulsar **Iniciar banco Cmd5**: este programa ya simula la planta
dentro del S7. El perfil fisico normal bloquea deliberadamente el control de
una imagen marcada como simulada.

En PLC Live Exchange observar:

| Accion | Escritura | Respuesta esperada |
| --- | --- | --- |
| Conectar | HR5 cambia | HR57 eco, HR23=1, HR59=1 |
| Habilitar manual | Cmd=0, Enable=1 | Parado, sin fallo |
| GOTO | HR6..13 y Cmd=4 | Target, RunMask y Pos evolucionan hasta completar |
| JOG | Cmd=3, HR2 eje, HR3 sentido, HR4=1 | Un eje cambia; HR4=0 detiene |
| HOME | Cmd=2 | Retorno virtual a [0,300,60,50] |
| AUTO | Cmd=1 | Secuencia original; esperar primero los 2 s de reposo IoT |
| STOP | Cmd=0 | RunMask y HR54 a cero; borra fallo enclavado |

`ScanCounter` del nuevo DB muestra ejecucion; las posiciones y el eco de heartbeat
confirman respuesta de logica, no solo exito de escritura Modbus. Las entradas
de prueba se manipulan en la llamada/DB del banco, no en las entradas fisicas.
Desactivar `InjectHealthyIoT` antes de ensayar valores IoT enviados por plataforma;
de lo contrario el PLC los reemplaza por muestras sinteticas en cada ciclo.

## Correspondencia de salidas logicas

| Orden virtual | Funcion del ejemplo |
| --- | --- |
| Q1 / Q2 | Pinza: positivo / negativo |
| Q3 / Q4 | Extension: positivo / negativo |
| Q5 / Q6 | Altura: negativo / positivo |
| Q7 / Q8 | Base: negativo / positivo |

Estos nombres son indices logicos, NO direcciones Siemens `%Q0.0..%Q0.7` ni numeros
de borne. Las direcciones reales se determinan desde la configuracion de hardware,
los tags y el esquema electrico. No se pueden deducir del mapa Modbus.

## Ensayos y vuelta a produccion

Probar sensor invalido, Homed falso, limites por eje, feedback congelado y perdida
de heartbeat. Deben detener o impedir el movimiento segun la logica original;
reconocer fallos con STOP antes de reintentar. Con feedback congelado el timeout
de movimiento es 30 s; no confundir ese plazo con el watchdog de 2500 ms.

Para volver a produccion: desconectar la plataforma, dejar STOP/Enable=0,
deshabilitar la llamada del banco y restaurar la llamada anterior. Verificar que
HR58 vuelve a cero y que ninguna señal sintetica alimenta el controlador real.
No conectar motores hasta configurar y validar limites, sensores, accionamientos
y seguridad reales. El banco no certifica cableado ni seguridad funcional.

## Estado de verificacion

Fuente preparada para revision y compilacion en TIA; no compilada con TIA ni
probada en una CPU real desde este entorno. Los ensayos de plataforma con PLC
simulado no equivalen a validar esta nueva fuente en Siemens.
