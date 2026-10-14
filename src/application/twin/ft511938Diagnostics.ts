export type FtIssue = {
  code: string;
  detail: string;
  registers: number[];
};

const booleanFields: Array<[number, string]> = [
  [1, 'Enable'],
  [4, 'JogEnable'],
  [21, 'SafetyOK'],
  [22, 'DrivesReady'],
  [23, 'CommFresh'],
  [24, 'SensorOK'],
  [28, 'WiringVerified'],
  [29, 'PhysicalOutputEnable'],
  [50, 'Done'],
  [58, 'SimulationMode'],
  [59, 'StartupReady'],
];

const realFields: Array<[number, string, number, number]> = [
  [30, 'Pos1', -173, 173],
  [32, 'Pos2', 128, 362],
  [34, 'Pos3', -2, 182],
  [36, 'Pos4', 10, 72],
  [38, 'Target1', -173, 173],
  [40, 'Target2', 128, 362],
  [42, 'Target3', -2, 182],
  [44, 'Target4', 10, 72],
];

function readReal(words: number[], offset: number): number {
  const view = new DataView(new ArrayBuffer(4));
  view.setUint16(0, words[offset], false);
  view.setUint16(2, words[offset + 1], false);
  return view.getFloat32(0, false);
}

export function diagnoseFtImage(words: number[]): FtIssue[] {
  const issues: FtIssue[] = [];
  if (words.length !== 61) {
    return [{
      code: 'length',
      detail: `Se esperan 61 HR; recibidos ${words.length}.`,
      registers: [],
    }];
  }
  for (const [offset, name] of booleanFields) {
    if (words[offset] !== 0 && words[offset] !== 1) {
      issues.push({
        code: 'layout',
        detail: `HR${offset} ${name}=${words[offset]}: debe ser 0 o 1. Revisar offsets del DB y otros escritores.`,
        registers: [offset],
      });
    }
  }
  for (const [offset, name, lower, upper] of realFields) {
    const value = readReal(words, offset);
    if (!Number.isFinite(value) || value < lower || value > upper) {
      issues.push({
        code: 'feedback',
        detail: `HR${offset}..${offset + 1} ${name}=${value}; rango ${lower}..${upper}.`,
        registers: [offset, offset + 1],
      });
    }
  }
  if (words[59] === 1 && words[24] === 1) {
    const measuredInvalid = realFields.slice(0, 4).some(([offset, , lower, upper]) => {
      const value = readReal(words, offset);
      return !Number.isFinite(value) || value < lower || value > upper;
    });
    if (measuredInvalid) {
      issues.push({
        code: 'inconsistent',
        detail: 'SensorOK=1 con posiciones invalidas: la imagen no coincide con las comprobaciones del FB ejecutado.',
        registers: [24, 30, 32, 34, 36],
      });
    }
  }
  const physical = words[58] === 0;
  if (physical) {
    for (const [offset, name] of booleanFields.filter(([offset]) => [21, 22, 28, 29].includes(offset))) {
      if (words[offset] === 0) {
        issues.push({
          code: 'permit',
          detail: `HR${offset} ${name}=0: comprobar la entrada real del FB en TIA.`,
          registers: [offset],
        });
      }
    }
  }
  if (words[25] !== 15) {
    issues.push({
      code: 'homing',
      detail: `HR25 HomedMask=${words[25]}: faltan ejes referenciados.`,
      registers: [25],
    });
  }
  if (words[23] === 0) {
    issues.push({
      code: 'watchdog',
      detail: `CommFresh=0; HR5=${words[5]}, HR57=${words[57]}. Comprobar que MB_SERVER y el FB comparten el mismo DB.`,
      registers: [5, 23, 57],
    });
  }
  return issues;
}

export function compareFtWrite(offset: number, expected: number[], actual: number[]): FtIssue[] {
  if (actual.length !== expected.length) {
    return [{ code: 'readback', detail: 'Lectura de verificacion incompleta.', registers: [offset] }];
  }
  // HR5 is renewed independently while the command readback is in flight.
  // Compare the stable command fields without treating a newer lease as loss.
  return expected.flatMap((value, index) => offset + index === 5 || value === actual[index] ? [] : [{
    code: 'readback',
    detail: `HR${offset + index}: enviado ${value}, leido ${actual[index]}. Escritura aceptada por Modbus pero no conservada en la imagen.`,
    registers: [offset + index],
  }]);
}

export function ftWriteAllowed(offset: number, count: number): boolean {
  if (!Number.isInteger(offset) || !Number.isInteger(count) || count < 1) return false;
  return offset >= 0 && offset + count <= 21;
}
