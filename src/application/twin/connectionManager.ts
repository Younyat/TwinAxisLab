import type { ConnectionHealth, ConnectionProfile, ProtocolKind } from '../../domain/twin';
import type { ProtocolAdapter, ProtocolAdapterRegistry } from './protocolAdapter';

export type ManagedConnection = {
  profile: ConnectionProfile;
  health: ConnectionHealth;
  errorCount: number;
  reconnectCount: number;
  lastSeenUtc?: string;
};

const initialHealth = (profile: ConnectionProfile): ConnectionHealth => ({
  connectionId: profile.id,
  protocol: profile.protocol,
  state: 'DISCONNECTED',
  quality: 'COMM_LOST',
  updatedAtUtc: new Date(0).toISOString(),
  message: 'Not connected',
  metrics: { reconnectCount: 0 },
});

export class TwinAxisConnectionManager {
  private readonly connections = new Map<string, ManagedConnection>();

  constructor(private readonly adapters: ProtocolAdapterRegistry) {}

  add(profile: ConnectionProfile, adapter?: ProtocolAdapter) {
    if (adapter && (adapter.connectionId !== profile.id || adapter.protocol !== profile.protocol)) throw new Error(`Adapter does not match connection profile ${profile.id}.`);
    if (adapter) this.adapters.register(adapter);
    this.connections.set(profile.id, { profile: structuredClone(profile), health: initialHealth(profile), errorCount: 0, reconnectCount: 0 });
    return this.get(profile.id)!;
  }

  remove(connectionId: string) {
    if (this.connections.get(connectionId)?.health.state === 'ONLINE') throw new Error(`Disconnect ${connectionId} before removing it.`);
    return this.connections.delete(connectionId);
  }

  get(connectionId: string) { return this.connections.get(connectionId); }
  list() { return [...this.connections.values()].map((item) => structuredClone(item)); }

  update(connectionId: string, patch: Partial<Omit<ConnectionProfile, 'id' | 'protocol'>>) {
    const current = this.require(connectionId);
    if (current.health.state === 'ONLINE') throw new Error(`Disconnect ${connectionId} before editing its endpoint.`);
    current.profile = { ...current.profile, ...patch };
    return structuredClone(current);
  }

  async connect(connectionId: string) {
    const current = this.require(connectionId);
    if (!current.profile.enabled) throw new Error(`Connection ${connectionId} is disabled.`);
    const adapter = this.adapter(current.profile.id, current.profile.protocol);
    current.health = { ...initialHealth(current.profile), state: 'CONNECTING', quality: 'UNCERTAIN', updatedAtUtc: new Date().toISOString() };
    try {
      current.health = await adapter.connect();
      current.lastSeenUtc = current.health.updatedAtUtc;
    } catch (error) {
      current.errorCount += 1;
      current.health = { ...current.health, state: 'FAILED', quality: 'BAD', updatedAtUtc: new Date().toISOString(), message: error instanceof Error ? error.message : String(error) };
    }
    return structuredClone(current);
  }

  async disconnect(connectionId: string) {
    const current = this.require(connectionId);
    current.health = await this.adapter(current.profile.id, current.profile.protocol).disconnect();
    return structuredClone(current);
  }

  async refresh(connectionId: string) {
    const current = this.require(connectionId);
    current.health = this.adapter(current.profile.id, current.profile.protocol).health();
    if (current.health.state === 'ONLINE') current.lastSeenUtc = current.health.updatedAtUtc;
    return structuredClone(current);
  }

  async reconnect(connectionId: string) {
    const current = this.require(connectionId);
    current.reconnectCount += 1;
    try { await this.disconnect(connectionId); } catch { current.errorCount += 1; }
    const result = await this.connect(connectionId);
    current.health = { ...current.health, metrics: { ...current.health.metrics, reconnectCount: current.reconnectCount } };
    return { ...result, health: structuredClone(current.health), reconnectCount: current.reconnectCount };
  }

  private require(connectionId: string) {
    const connection = this.connections.get(connectionId);
    if (!connection) throw new Error(`Unknown connection ${connectionId}.`);
    return connection;
  }

  private adapter(connectionId: string, protocol: ProtocolKind) {
    const adapter = this.adapters.get(connectionId, protocol);
    if (!adapter) throw new Error(`No ${protocol} adapter registered for ${connectionId}.`);
    return adapter;
  }
}
