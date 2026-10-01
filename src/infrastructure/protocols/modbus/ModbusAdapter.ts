import type { ConnectionHealth, ModbusMapping, SignalBinding, TwinSignalValue } from '../../../domain/twin';
import type { ProtocolAdapter, ProtocolReadResult, ProtocolSubscription } from '../../../application/twin/protocolAdapter';
import { decodeModbusValue, encodeModbusValue } from '../../../application/twin/modbusCodec';

export type ModbusTransport = {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  readHoldingRegisters(address: number, quantity: number, unitId: number): Promise<number[]>;
  writeHoldingRegisters(address: number, values: number[], unitId: number): Promise<void>;
};

export type ModbusAdapterOptions = { connectionId: string; endpoint: string; unitId: number; transport: ModbusTransport };

export class ModbusAdapter implements ProtocolAdapter {
  readonly protocol = 'modbus' as const;
  readonly connectionId: string;
  private connected = false;
  private lastSeen?: string;
  private errorCount = 0;

  constructor(private readonly options: ModbusAdapterOptions) { this.connectionId = options.connectionId; }

  health(): ConnectionHealth {
    return { connectionId: this.connectionId, protocol: this.protocol, state: this.connected ? 'ONLINE' : 'DISCONNECTED', quality: this.connected ? 'GOOD' : 'COMM_LOST', updatedAtUtc: this.lastSeen ?? new Date(0).toISOString(), metrics: { reconnectCount: 0 }, message: this.connected ? 'Modbus TCP connected' : 'Modbus TCP disconnected' };
  }

  metadata() { return { endpoint: this.options.endpoint, unitId: this.options.unitId, errorCount: this.errorCount, lastSeen: this.lastSeen }; }
  async connect() { await this.options.transport.connect(); this.connected = true; this.lastSeen = new Date().toISOString(); return this.health(); }
  async disconnect() { await this.options.transport.disconnect(); this.connected = false; this.lastSeen = new Date().toISOString(); return this.health(); }

  private mapping(binding: SignalBinding): ModbusMapping {
    if (binding.protocol !== 'modbus' || binding.source.kind !== 'modbus') throw new Error(`SignalBinding ${binding.id} is not a Modbus binding.`);
    if (binding.source.area !== 'holding-register') throw new Error('ModbusAdapter currently requires holding-register mappings.');
    return binding.source;
  }

  async read(binding: SignalBinding): Promise<ProtocolReadResult> {
    const mapping = this.mapping(binding);
    try {
      const words = await this.options.transport.readHoldingRegisters(mapping.address, mapping.quantity, this.options.unitId);
      this.lastSeen = new Date().toISOString();
      return { bindingId: binding.id, value: decodeModbusValue(words, mapping), timestampUtc: this.lastSeen, quality: 'GOOD', raw: { words, address: mapping.address } };
    } catch (error) { this.errorCount += 1; throw error; }
  }

  async write(binding: SignalBinding, value: TwinSignalValue): Promise<ProtocolReadResult> {
    const mapping = this.mapping(binding);
    const request = encodeModbusValue(value, mapping);
    const words = request.registers ?? [];
    await this.options.transport.writeHoldingRegisters(mapping.address, words, this.options.unitId);
    this.lastSeen = new Date().toISOString();
    return { bindingId: binding.id, value, timestampUtc: this.lastSeen, quality: 'GOOD', raw: { words, address: mapping.address } };
  }

  async subscribe(binding: SignalBinding, listener: (result: ProtocolReadResult) => void): Promise<ProtocolSubscription> {
    const timer = setInterval(() => void this.read(binding).then(listener).catch(() => undefined), Math.max(50, binding.pollingMs ?? 250));
    return { unsubscribe: () => clearInterval(timer) };
  }
}
