# Fuente S7 corregida y comprobacion pendiente

El archivo `cobot_6dof_iot_condition_monitoring_s7_1200_compatible.scl`
es una fuente externa completa para los nombres existentes `RobotHolding`
y `RobotArmControl`. Define el UDT antes del DB. El cuerpo usa directamente
`RobotHolding.Struct`; no requiere un parametro InOut llamado `HR`.

Se corrigieron el envoltorio incompleto del FB, la consigna de J2 durante
la fase 4 de GOTO y el orden de HOME, que ahora establece altura primero.
El codigo OpenPLC no se ha modificado.

## Aplicacion en TIA

1. Conservar una copia del proyecto TIA antes de generar los bloques.
2. Importar la fuente SCL y generar UDT, RobotHolding y RobotArmControl.
3. Actualizar la instancia existente RobotArmControl_DB y la llamada desde OB1.
4. Mantener las conexiones reales de SafetyOK, DrivesReady, WiringVerified,
   PhysicalOutputEnable, FeedbackValid, Homed, MinLimit, MaxLimit y PosMeasured.
5. Confirmar que MB_SERVER expone RobotHolding.Struct. No usar un segundo DB
   de holding registers que no este sincronizado con este bloque.
6. En el DB no optimizado, comprobar estos offsets antes de descargar:

| Campo | Byte | HR |
|---|---:|---:|
| Cmd | 0 | 0 |
| HeartbeatSequence | 10 | 5 |
| SensorValid | 30 | 15 |
| SafetyOK | 42 | 21 |
| PhysicalOutputEnable | 58 | 29 |
| Pos1 | 60 | 30 |
| Pos2 | 64 | 32 |
| Pos4 | 72 | 36 |
| Target2 | 80 | 40 |
| HeartbeatEcho | 114 | 57 |
| StartupReady | 118 | 59 |
| DoneCounter | 120 | 60 |

La imagen contiene 122 bytes, 61 palabras. El argumento de MB_SERVER depende
de la version de la instruccion; usar la misma area de DB con ese tamano.

## Criterios de comprobacion online

- HR5 y HeartbeatSequence deben coincidir; HR57 debe reflejar el heartbeat
  procesado por el FB, admitiendo el retraso de un scan.
- Una escritura de telemetria HR15..20 debe verse en los mismos campos del DB.
- PhysicalOutputEnable solo puede publicarse como 0 o 1. Un valor 3 implica
  otra distribucion de memoria u otro escritor; no es un permiso valido.
- SensorOK no debe ser 1 si Pos2 o Pos4 estan fuera de sus rangos.
- Los permisos proceden de las entradas del FB. No forzarlos desde Modbus.
- Cmd=1 debe evaluarse con Enable, permisos, homing y heartbeat disponibles.
- Con policy=0 AUTO espera dos segundos sin movimiento; policy=1 requiere
  movimiento. Telemetria invalida o degradada mantiene AUTO en espera.

## Limite de la validacion local

Las pruebas del repositorio verifican estructura, mapa, consignas de los
16 tramos y transporte Modbus contra un servidor de prueba. No sustituyen
la compilacion en TIA ni la prueba online del programa descargado.

Sin actuadores y posiciones medidas cambiantes, este controlador fisico
no anima por si mismo el robot. Las vistas representan HR30..37. Una prueba
sin hardware requiere un modelo de planta o simulacion explicitamente
identificado; esta reparacion no convierte consignas en posiciones medidas.
