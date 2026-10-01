import type { SignalBinding, TwinProperty } from '../../domain/twin';
import { ModbusAdapter, type ModbusTransport } from '../../infrastructure/protocols/modbus/ModbusAdapter';
import { ProtocolAdapterRegistry } from './protocolAdapter';
import { TwinAxisRuntime } from './twinAxisRuntime';

const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };

const property: TwinProperty = {
  id: 'robot01.j1.position', componentId: 'robot01', path: 'robot01/joints/j1/position', name: 'J1 Position', dataType: 'float', unit: 'rad',
  access: 'READ_WRITE', writable: true, range: { min: -3.14, max: 3.14 }, safeRange: { min: -2.8, max: 2.8 }, requiresConfirmation: true, quality: 'STALE', metadata: { jointId: 'j1' },
};

const binding: SignalBinding = {
  id: 'binding-j1-position', propertyId: property.id, connectionId: 'openplc-main', protocol: 'modbus',
  source: { kind: 'modbus', area: 'holding-register', address: 100, quantity: 1, dataType: 'i16', byteOrder: 'be', displayAddress: '40101' },
  dataType: 'INT16', transform: { scale: 0.0001, offset: 0, unitIn: 'raw', unitOut: 'rad' }, direction: 'READ_WRITE', pollingMs: 250,
  qualityPolicy: { staleAfterMs: 1000, badAfterMs: 3000, outOfRangeQuality: 'OUT_OF_RANGE', missingTimestampQuality: 'UNCERTAIN' }, status: 'DISCONNECTED', enabled: true, metadata: {},
};

export const runTwinAxisRuntimeTests = async () => {
  let words = [12500];
  const writes: number[][] = [];
  const transport: ModbusTransport = {
    connect: async () => undefined,
    disconnect: async () => undefined,
    readHoldingRegisters: async (address, quantity) => { assert(address === 100 && quantity === 1, 'ModbusAdapter used the wrong mapping.'); return words; },
    writeHoldingRegisters: async (_address, values) => { writes.push(values); words = values; },
  };
  const adapter = new ModbusAdapter({ connectionId: 'openplc-main', endpoint: '127.0.0.1:502', unitId: 1, transport });
  const registry = new ProtocolAdapterRegistry(); registry.register(adapter); await adapter.connect();
  const runtime = new TwinAxisRuntime([property], [binding], registry);
  const read = await runtime.read(binding.id);
  assert(Math.abs(Number(read.value) - 1.25) < 0.00001, 'Protocol -> SignalBinding -> TwinProperty scaling failed.');
  let confirmationBlocked = false;
  try { await runtime.write(property.id, 2); } catch { confirmationBlocked = true; }
  assert(confirmationBlocked, 'Confirmed TwinProperty write was not protected.');
  await runtime.write(property.id, 2, true);
  assert(writes[0]?.[0] === 20000, 'TwinProperty -> SignalBinding -> ModbusAdapter inverse scaling failed.');
  let safeRangeBlocked = false;
  try { await runtime.write(property.id, 3, true); } catch { safeRangeBlocked = true; }
  assert(safeRangeBlocked, 'TwinProperty safe range was not enforced.');
  assert(runtime.state().properties[property.id].value === 2, 'TwinAxis Runtime did not retain the confirmed property value.');
  await adapter.disconnect();
  console.log('TwinAxis runtime tests passed: ModbusAdapter -> SignalBinding -> TwinProperty and confirmed writes.');
};
