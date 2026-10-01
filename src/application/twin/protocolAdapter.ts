import type { ConnectionHealth, ProtocolKind, SignalBinding, TwinSignalValue } from '../../domain/twin';

export type ProtocolReadResult = {
  bindingId: string;
  value: TwinSignalValue;
  timestampUtc: string;
  quality: 'GOOD' | 'UNCERTAIN' | 'BAD' | 'STALE' | 'COMM_LOST' | 'OUT_OF_RANGE' | 'CONFIG_ERROR' | 'SIMULATED';
  raw?: unknown;
};

export type ProtocolSubscription = { unsubscribe: () => Promise<void> | void };

export interface ProtocolAdapter {
  readonly protocol: ProtocolKind;
  readonly connectionId: string;
  connect(): Promise<ConnectionHealth>;
  disconnect(): Promise<ConnectionHealth>;
  read(binding: SignalBinding): Promise<ProtocolReadResult>;
  write(binding: SignalBinding, value: TwinSignalValue): Promise<ProtocolReadResult>;
  subscribe(binding: SignalBinding, listener: (result: ProtocolReadResult) => void): Promise<ProtocolSubscription>;
  health(): ConnectionHealth;
  metadata(): Record<string, unknown>;
}

export class ProtocolAdapterRegistry {
  private readonly adapters = new Map<string, ProtocolAdapter>();

  register(adapter: ProtocolAdapter) {
    this.adapters.set(adapter.connectionId, adapter);
  }

  get(connectionId: string, protocol?: ProtocolKind) {
    const adapter = this.adapters.get(connectionId);
    return adapter && (!protocol || adapter.protocol === protocol) ? adapter : undefined;
  }

  list() {
    return [...this.adapters.values()];
  }
}
