import type { ConnectionHealth, OpcUaMapping, SignalBinding, TwinSignalValue } from '../../../domain/twin';
import type { ProtocolAdapter, ProtocolReadResult, ProtocolSubscription } from '../../../application/twin/protocolAdapter';

export type OpcUaGatewayAdapterOptions = { connectionId: string; gatewayUrl: string; endpointUrl: string; securityPolicy?: string; timeoutMs?: number };

export class OpcUaGatewayAdapter implements ProtocolAdapter {
  readonly protocol = 'opcua' as const;
  readonly connectionId: string;
  private connected = false;
  private lastSeen?: string;
  private errorCount = 0;
  constructor(private readonly options: OpcUaGatewayAdapterOptions) { this.connectionId = options.connectionId; }
  private mapping(binding: SignalBinding): OpcUaMapping { if (binding.protocol !== 'opcua' || binding.source.kind !== 'opcua') throw new Error(`SignalBinding ${binding.id} is not an OPC UA binding.`); return binding.source; }
  private async request(path: string, body: Record<string, unknown>) { const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 8000); try { const response = await fetch(`${this.options.gatewayUrl.replace(/\/$/, '')}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpointUrl: this.options.endpointUrl, securityPolicy: this.options.securityPolicy ?? 'None', ...body }), signal: controller.signal }); if (!response.ok) throw new Error(`OPC UA gateway ${path} failed: HTTP ${response.status}`); return await response.json() as Record<string, unknown>; } finally { clearTimeout(timer); } }
  health(): ConnectionHealth { return { connectionId: this.connectionId, protocol: this.protocol, state: this.connected ? 'ONLINE' : 'DISCONNECTED', quality: this.connected ? 'GOOD' : 'COMM_LOST', updatedAtUtc: this.lastSeen ?? new Date(0).toISOString(), message: this.connected ? 'OPC UA session connected through gateway' : 'OPC UA disconnected' }; }
  metadata() { return { gatewayUrl: this.options.gatewayUrl, endpointUrl: this.options.endpointUrl, securityPolicy: this.options.securityPolicy ?? 'None', errorCount: this.errorCount, lastSeen: this.lastSeen }; }
  async connect() { await this.request('/connect', {}); this.connected = true; this.lastSeen = new Date().toISOString(); return this.health(); }
  async disconnect() { if (this.connected) await this.request('/disconnect', {}); this.connected = false; this.lastSeen = new Date().toISOString(); return this.health(); }
  async read(binding: SignalBinding): Promise<ProtocolReadResult> { const mapping = this.mapping(binding); try { const result = await this.request('/read', { nodeId: mapping.nodeId, browsePath: mapping.browsePath, namespaceUri: mapping.namespaceUri }); this.lastSeen = String(result.timestampUtc ?? new Date().toISOString()); return { bindingId: binding.id, value: result.value as TwinSignalValue, timestampUtc: this.lastSeen, quality: result.quality === 'GOOD' ? 'GOOD' : 'UNCERTAIN', raw: result }; } catch (error) { this.errorCount += 1; throw error; } }
  async write(binding: SignalBinding, value: TwinSignalValue): Promise<ProtocolReadResult> { const mapping = this.mapping(binding); const result = await this.request('/write', { nodeId: mapping.nodeId, value, dataType: binding.dataType }); this.lastSeen = String(result.timestampUtc ?? new Date().toISOString()); return { bindingId: binding.id, value, timestampUtc: this.lastSeen, quality: result.quality === 'GOOD' ? 'GOOD' : 'UNCERTAIN', raw: result }; }
  async subscribe(binding: SignalBinding, listener: (result: ProtocolReadResult) => void): Promise<ProtocolSubscription> { const timer = setInterval(() => void this.read(binding).then(listener).catch(() => undefined), Math.max(100, binding.pollingMs ?? 1000)); return { unsubscribe: () => clearInterval(timer) }; }
}
