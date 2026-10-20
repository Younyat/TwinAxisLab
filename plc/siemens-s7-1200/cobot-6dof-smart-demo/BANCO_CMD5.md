# Banco de pruebas Cmd=5

La misma fuente conserva los modos 0..4 y todas sus declaraciones. El banco no
anade registros, variables de FB ni parametros a OB1. OpenPLC no se modifica.
Se debe compilar y descargar el SCL actualizado en TIA antes de usar el banco.
La plataforma rechaza un controlador que no confirme ActiveMode=5 y HR58=1.

## Contrato exclusivo de Cmd=5

| Registros | Funcion en el banco |
| --- | --- |
| HR0 | 5 banco, 0 detener y rearmar |
| HR1 | Habilitacion del banco |
| HR2 | Mascara limites minimos, bits 0..3 |
| HR3 | Mascara limites maximos, bits 0..3 |
| HR4 | Bit 0 feedback valido, bit 1 ejes referenciados |
| HR5 | Heartbeat con watchdog 2500 ms |
| HR6..13 | Cuatro posiciones simuladas REAL32, palabra alta primero |
| HR14..20 | IoT conserva datos y diagnostico, no bloquea este banco |
| HR21/22/28 | Permisos reales, nunca se falsifican |
| HR23 | Watchdog del PLC |
| HR24..27 | Validez, homing y limites simulados |
| HR29 | Siempre 0 en banco |
| HR30..37 | Eco de las posiciones simuladas |
| HR38..45 | Objetivo de la secuencia existente de 16 pasos |
| HR46..50 | Estado, modo 5, paso, fallo y completado |
| HR51/52 | Diagnostico IoT real, independiente del banco |
| HR53 | 1000 nominal; no es un mando de potencia |
| HR54 | Siempre 0: no son salidas electricas |
| HR55/56 | Ordenes logicas de marcha y sentido para la planta virtual |
| HR57..60 | Eco heartbeat, simulacion=1, startup y contador |

Run, DirectionPositive y CmdQ1toQ8 del FB se inicializan a FALSE antes de
la rama del banco y nunca se activan en ella. La rama retorna antes de la logica
fisica. Si la entrada PhysicalOutputEnable del FB es TRUE se enclava fallo 1.
Al salir de Cmd=5 se exige STOP y se deshabilita Enable, sin transferencia
automatica a movimiento fisico. Los fallos se rearman con STOP, no solos.

## Uso

1. Aislar electricamente los actuadores y revisar OB1. No usar HR55 como una
   salida fisica: en banco contiene exclusivamente ordenes para la planta virtual.
2. Cargar el SCL, sin cambiar el UDT ni el mapa de MB_SERVER.
3. Conectar el perfil Physical S7 FT511938 HR0..60 en la plataforma.
4. Iniciar banco, confirmar aislamiento. Se inicializa la planta en [0,300,60,50].
5. Activar REPO CAPTURE para registrar bench closed-loop verification.
6. Probar limites, feedback congelado, sensor invalido o perdida de homing.
   Fallos esperados: 2 homing, 3 feedback, 4 limite, 5 timeout 30 s, 6 watchdog.
7. Detener banco antes de recuperar el modo fisico. Revisar las mediciones reales.

La plataforma solo integra posiciones a partir de HR55/56, limita cada avance
a 250 ms, comprueba el eco de feedback y nunca intenta recuperar tiempo perdido
con saltos. Al detener, cambiar endpoint, desmontar panel o perder comunicacion
intenta escribir STOP. Si no hay red, el watchdog del PLC inhibe la marcha logica.
No se reanuda automaticamente despues de cambiar endpoint o desconectar.

## AUTO local

AUTO local sin PLC/IoT reproduce el clip del robot importado en las vistas,
sin escribir Modbus. Solo esta disponible sin endpoint PLC habilitado. Conectar
un PLC detiene este modo; no reanuda al desconectarlo. No es una prueba del S7.

## Limites de verificacion

Las pruebas de software comprueban formato, contrato y planta virtual. No hay
compilador TIA en este entorno: compilar y revisar diagnosticos de TIA antes de
descargar. No se ha probado contra el S7 real ni se certifican tiempos de scan,
drivers, cableado, seguridad funcional o correspondencia con bornes fisicos.
Los BOOL de seguridad de este FB no sustituyen una cadena de seguridad real.
