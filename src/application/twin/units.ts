export type EngineeringUnit = 'rad' | 'deg' | 'm' | 'mm' | 'celsius' | 'kelvin' | 'pascal' | 'bar' | 'rpm' | 'ampere' | 'volt' | 'watt' | 'newton-metre' | 'percent';

type UnitDefinition = { family: string; symbol: string; toBase: (value: number) => number; fromBase: (value: number) => number };

export const engineeringUnits: Record<EngineeringUnit, UnitDefinition> = {
  rad: { family: 'angle', symbol: 'rad', toBase: (v) => v, fromBase: (v) => v },
  deg: { family: 'angle', symbol: 'deg', toBase: (v) => v * Math.PI / 180, fromBase: (v) => v * 180 / Math.PI },
  m: { family: 'distance', symbol: 'm', toBase: (v) => v, fromBase: (v) => v },
  mm: { family: 'distance', symbol: 'mm', toBase: (v) => v / 1000, fromBase: (v) => v * 1000 },
  celsius: { family: 'temperature', symbol: 'C', toBase: (v) => v + 273.15, fromBase: (v) => v - 273.15 },
  kelvin: { family: 'temperature', symbol: 'K', toBase: (v) => v, fromBase: (v) => v },
  pascal: { family: 'pressure', symbol: 'Pa', toBase: (v) => v, fromBase: (v) => v },
  bar: { family: 'pressure', symbol: 'bar', toBase: (v) => v * 100000, fromBase: (v) => v / 100000 },
  rpm: { family: 'angular-speed', symbol: 'rpm', toBase: (v) => v * Math.PI / 30, fromBase: (v) => v * 30 / Math.PI },
  ampere: { family: 'current', symbol: 'A', toBase: (v) => v, fromBase: (v) => v },
  volt: { family: 'voltage', symbol: 'V', toBase: (v) => v, fromBase: (v) => v },
  watt: { family: 'power', symbol: 'W', toBase: (v) => v, fromBase: (v) => v },
  'newton-metre': { family: 'torque', symbol: 'Nm', toBase: (v) => v, fromBase: (v) => v },
  percent: { family: 'ratio', symbol: '%', toBase: (v) => v / 100, fromBase: (v) => v * 100 },
};

export const convertEngineeringUnit = (value: number, from: EngineeringUnit, to: EngineeringUnit) => {
  const source = engineeringUnits[from];
  const target = engineeringUnits[to];
  if (source.family !== target.family) throw new Error(`Cannot convert ${from} to incompatible unit ${to}.`);
  return target.fromBase(source.toBase(value));
};
