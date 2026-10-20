# Physical PLC Sources

Siemens S7-1200 / TIA Portal sources are in
`siemens-s7-1200/cobot-6dof-smart-demo/`.

The current physical controller is
`cobot_6dof_iot_condition_monitoring_s7_1200_compatible.scl`.
Files labelled copy, old or .bak are historical copies, not the active source.

OpenPLC simulation programs remain in `../openplc/cobot-6dof-smart-demo/`.
Do not import the Siemens external sources into OpenPLC.

Validation: `npm.cmd run test:s7:ft511938`.
Moving these files does not change or download the program running on a PLC.
