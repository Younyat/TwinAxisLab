import { useState } from 'react';
import { FT511938_REGISTER_MAP } from '../../application/twin/ft511938PlcContract';

export function FtRegisterMonitor({ words, online }: { words?: number[]; online: boolean }) {
  const [query, setQuery] = useState('');
  const available = words !== undefined && words.length >= 61;
  const descriptions: Record<number, string> = {
    0: 'Orden: 0 STOP, 1 AUTO, 2 HOME, 3 JOG, 4 posicion manual, 5 banco aislado.',
    1: 'Habilitacion del controlador. No sustituye los permisos de seguridad.',
    2: 'Eje de JOG; en Cmd5, bits de finales minimos simulados.',
    3: 'Sentido de JOG; en Cmd5, bits de finales maximos simulados.',
    4: 'Mantiene JOG activo; en Cmd5, bit 0 sensor valido y bit 1 ejes referenciados.',
    5: 'Secuencia enviada por la plataforma. Debe cambiar para mantener el watchdog.',
    14: 'Politica AUTO IoT: 0 exige reposo; 1 exige movimiento. Otro valor es invalido.',
    15: 'Validez de la muestra IoT recibida.', 16: 'Mascara de calidad de sensores IoT.',
    17: 'Antiguedad de la muestra IoT en milisegundos.',
    18: 'Temperatura: dividir por 100 para obtener grados C.',
    19: 'Humedad: dividir por 100 para obtener porcentaje.',
    20: 'Giroscopio: dividir por 100 para obtener grados por segundo.',
    21: 'Permiso de seguridad recibido por el FB desde su entrada SafetyOK.',
    22: 'Accionamientos preparados, recibido desde DrivesReady.',
    23: 'Watchdog: 1 indica que el PLC ha recibido un heartbeat reciente.',
    24: 'Posiciones validas y plausibles segun el PLC.',
    25: 'Bits de referencia de ejes 1..4: 1, 2, 4, 8; todos = 15.',
    26: 'Bits de finales minimos de los cuatro ejes.', 27: 'Bits de finales maximos de los cuatro ejes.',
    28: 'Confirmacion de verificacion del cableado, entrada del FB.',
    29: 'Permiso de salidas fisicas. Debe ser 0 en el banco.',
    46: 'Estado: 0 parado, 1 movimiento, 2 terminado, 3 fallo.',
    47: 'Modo realmente reconocido por el PLC; 5 identifica el banco.',
    48: 'Paso de la trayectoria o fase del movimiento manual.',
    49: 'Fallo: 1 permisos, 2 referencia, 3 feedback, 4 limite, 5 timeout, 6 heartbeat, 7 comando, 10 salidas opuestas.',
    50: 'Pulso de movimiento completado.', 51: 'Alarma IoT independiente del fallo de movimiento.',
    52: 'Condicion IoT: 0 normal, 1 degradada, 2 critica, 3 invalida. No bloquea Cmd5.',
    53: 'Indicador de velocidad en milesimas; no es PWM de los reles.',
    54: 'Bits de orden Q1..Q8. En el banco deben permanecer a 0; no mide tension electrica.',
    55: 'Ejes con orden de marcha, bits 1/2/4/8. En el banco son ordenes virtuales.',
    56: 'Bits de sentido positivo de los ejes en marcha.',
    57: 'Ultimo heartbeat reconocido por el PLC.',
    58: '1 identifica simulacion o banco; no autoriza salidas fisicas.',
    59: 'El bloque se ha ejecutado al menos una vez. No certifica puesta en marcha.',
    60: 'Contador de movimientos completados.',
  };
  const blockers = available ? [21,22,23,24,28,29].filter(i => words![i] === 0).map(i => FT511938_REGISTER_MAP.find(row => row.offset === i)!.name) : [];
  return <section aria-label="Registros RobotHolding" style={{ width: '100%', minWidth: 0, marginBlock: 16 }}>
    <h3 style={{ fontSize: 16, marginBlock: 8 }}>RobotHolding · HR0..60</h3>
    <strong role="status" style={{ color: online && available ? '#15803d' : '#b45309' }}>
      {online && available ? 'LECTURA CONECTADA' : available ? 'DESCONECTADO · ULTIMA LECTURA' : 'SIN DATOS DEL PLC'}
    </strong>
    {available && <p style={{ whiteSpace: 'normal', lineHeight: 1.5 }}>Movimiento fisico: {blockers.length || words![25] !== 15 ? `bloqueado (${[...blockers, ...(words![25] !== 15 ? ['ejes no referenciados'] : [])].join(', ')})` : 'permisos principales presentes; verificar orden y alarmas'}. Banco: {words![47] === 5 && words![58] === 1 ? 'reconocido por el PLC' : 'no activo'}. AUTO IoT: {words![14] > 1 ? `SensorPolicy=${words![14]} invalido` : `ConditionState=${words![52]}`}. Lectura de registros, no verificacion electrica.</p>}
    <input aria-label="Buscar registro" placeholder="Buscar nombre o HR" value={query} onChange={event => setQuery(event.target.value)} style={{ display: 'block', marginBlock: 12, width: '100%', maxWidth: 360, boxSizing: 'border-box' }} />
    <div style={{ overflow: 'auto', maxHeight: 560, border: '1px solid #94a3b8' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, whiteSpace: 'nowrap' }}>
        <thead style={{ position: 'sticky', top: 0, background: '#172027', color: '#fff', zIndex: 1 }}><tr>{['Registro', 'Variable TIA', 'Byte DB', 'Tipo', 'Valor leido', 'Palabras HEX', 'Direccion'].map(label => <th key={label} style={{ padding: '10px 12px', textAlign: 'left' }}>{label}</th>)}</tr></thead>
        <tbody>{FT511938_REGISTER_MAP.filter(row => `${row.name} HR${row.offset}`.toLowerCase().includes(query.toLowerCase())).map(row => {
          const real = row.semantic.includes('REAL32');
          const signed = [0, 2, 3, 18].includes(row.offset);
          const present = words !== undefined && words.length > row.offset + (real ? 1 : 0);
          const raw = present ? words!.slice(row.offset, row.offset + (real ? 2 : 1)) : [];
          let value = raw[0];
          if (real && present) {
            const view = new DataView(new ArrayBuffer(4));
            view.setUint16(0, raw[0], false);
            view.setUint16(2, raw[1], false);
            value = view.getFloat32(0, false);
          } else if (signed && value >= 32768) value -= 65536;
          const invalid = present && (!Number.isFinite(value) || (row.offset === 14 && value !== 0 && value !== 1));
          const name = row.name.replace(/\[(\d)\]/, '$1');
          return <tr key={row.offset} style={{ borderBottom: '1px solid #64748b55', background: invalid ? '#fef3c7' : undefined, color: invalid ? '#92400e' : undefined }}>
            <td style={{ padding: '8px 12px' }}>HR{row.offset}{real ? `..${row.offset + 1}` : ''}</td>
            <td style={{ padding: '8px 12px', fontWeight: 600, whiteSpace: 'normal', minWidth: 190 }}><details><summary style={{ cursor: 'pointer' }}>{name}</summary><p style={{ maxWidth: 320, fontWeight: 400, lineHeight: 1.5 }}>{descriptions[row.offset] ?? (row.offset < 14 ? 'Posicion objetivo manual; en Cmd5 se reutiliza como feedback simulado.' : row.offset < 38 ? 'Posicion medida del eje; en Cmd5 refleja el feedback simulado enviado.' : 'Posicion objetivo calculada por el PLC para este eje.')}</p></details></td>
            <td style={{ padding: '8px 12px' }}>{row.offset * 2}.0</td>
            <td style={{ padding: '8px 12px' }}>{real ? 'REAL' : signed ? 'INT' : 'UINT'}</td>
            <td style={{ padding: '8px 12px', fontWeight: 700, fontVariantNumeric: 'tabular-nums', fontSize: 16 }}>{present ? real && Number.isFinite(value) ? value.toFixed(3) : String(value) : '--'}{invalid ? ' · INVALIDO' : ''}</td>
            <td style={{ padding: '8px 12px', fontFamily: 'monospace' }}>{raw.map(word => `0x${word.toString(16).padStart(4, '0').toUpperCase()}`).join(' ') || '--'}</td>
            <td style={{ padding: '8px 12px' }}>{row.access === 'platform-to-plc' ? 'Plataforma → PLC' : 'PLC → Plataforma'}</td>
          </tr>;
        })}</tbody>
      </table>
    </div>
  </section>;
}
