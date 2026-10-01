import mqtt, { type IClientOptions, type MqttClient } from 'mqtt';
import type { ConnectionHealth, MqttMapping, SignalBinding, TwinSignalValue } from '../../../domain/twin';
import type { ProtocolAdapter, ProtocolReadResult, ProtocolSubscription } from '../../../application/twin/protocolAdapter';
import { decodeMqttPayload } from '../../../application/twin/mqttCodec';

export type MqttAdapterOptions = { connectionId: string; endpoint: string; clientOptions?: IClientOptions; connectTimeoutMs?: number; readTimeoutMs?: number };

export class MqttAdapter implements ProtocolAdapter {
  readonly protocol = 'mqtt' as const;
  readonly connectionId: string;
  private client?: MqttClient;
  private connected = false;
  private lastSeen?: string;
  private errorCount = 0;
  private reconnectCount = 0;
  constructor(private readonly options: MqttAdapterOptions) { this.connectionId = options.connectionId; }
  private mapping(binding: SignalBinding): MqttMapping { if (binding.protocol !== 'mqtt' || binding.source.kind !== 'mqtt') throw new Error(`SignalBinding ${binding.id} is not an MQTT binding.`); return binding.source; }
  health(): ConnectionHealth { return { connectionId: this.connectionId, protocol: this.protocol, state: this.connected ? 'ONLINE' : this.client?.reconnecting ? 'RECONNECTING' : 'DISCONNECTED', quality: this.connected ? 'GOOD' : 'COMM_LOST', updatedAtUtc: this.lastSeen ?? new Date(0).toISOString(), message: this.connected ? 'MQTT broker connected' : 'MQTT broker disconnected', metrics: { reconnectCount: this.reconnectCount } }; }
  metadata() { return { endpoint: this.options.endpoint, errorCount: this.errorCount, lastSeen: this.lastSeen, transport: 'MQTT.js' }; }
  async connect() {
    if (this.connected) return this.health();
    this.client = mqtt.connect(this.options.endpoint, { reconnectPeriod: 1000, connectTimeout: this.options.connectTimeoutMs ?? 10000, ...this.options.clientOptions });
    this.client.on('reconnect', () => { this.reconnectCount += 1; }); this.client.on('error', () => { this.errorCount += 1; });
    await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new Error(`MQTT connection timeout: ${this.options.endpoint}`)), this.options.connectTimeoutMs ?? 10000); this.client!.once('connect', () => { clearTimeout(timer); this.connected = true; this.lastSeen = new Date().toISOString(); resolve(); }); this.client!.once('error', (error) => { clearTimeout(timer); reject(error); }); });
    return this.health();
  }
  async disconnect() { if (this.client) await new Promise<void>((resolve, reject) => this.client!.end(false, {}, (error) => error ? reject(error) : resolve())); this.connected = false; this.client = undefined; this.lastSeen = new Date().toISOString(); return this.health(); }
  async read(binding: SignalBinding): Promise<ProtocolReadResult> {
    const mapping = this.mapping(binding); if (!this.client || !this.connected) throw new Error('MQTT adapter is not connected.');
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { cleanup(); reject(new Error(`MQTT read timeout on ${mapping.topic}`)); }, this.options.readTimeoutMs ?? 5000);
      const onMessage = (topic: string, payload: Buffer) => { if (topic !== mapping.topic) return; cleanup(); this.lastSeen = new Date().toISOString(); resolve({ bindingId: binding.id, value: decodeMqttPayload({ topic, payload, receivedAtUtc: this.lastSeen, qos: mapping.qos, retain: mapping.retained }, mapping), timestampUtc: this.lastSeen, quality: 'GOOD', raw: { topic, bytes: payload.length } }); };
      const cleanup = () => { clearTimeout(timeout); this.client?.off('message', onMessage); void this.client?.unsubscribeAsync(mapping.topic); };
      this.client!.on('message', onMessage); void this.client!.subscribeAsync(mapping.topic, { qos: mapping.qos ?? 0 }).catch((error) => { cleanup(); reject(error); });
    });
  }
  async write(binding: SignalBinding, value: TwinSignalValue): Promise<ProtocolReadResult> { const mapping = this.mapping(binding); if (!this.client || !this.connected) throw new Error('MQTT adapter is not connected.'); const topic = typeof binding.metadata.commandTopic === 'string' ? binding.metadata.commandTopic : mapping.topic; const payload = mapping.payload === 'raw' ? String(value) : JSON.stringify(value); await this.client.publishAsync(topic, payload, { qos: mapping.qos ?? 0, retain: mapping.retained ?? false }); this.lastSeen = new Date().toISOString(); return { bindingId: binding.id, value, timestampUtc: this.lastSeen, quality: 'GOOD', raw: { topic, payload } }; }
  async subscribe(binding: SignalBinding, listener: (result: ProtocolReadResult) => void): Promise<ProtocolSubscription> { const mapping = this.mapping(binding); if (!this.client || !this.connected) throw new Error('MQTT adapter is not connected.'); const handler = (topic: string, payload: Buffer) => { if (topic !== mapping.topic) return; this.lastSeen = new Date().toISOString(); listener({ bindingId: binding.id, value: decodeMqttPayload({ topic, payload, receivedAtUtc: this.lastSeen, qos: mapping.qos, retain: mapping.retained }, mapping), timestampUtc: this.lastSeen, quality: 'GOOD', raw: { topic, bytes: payload.length } }); }; await this.client.subscribeAsync(mapping.topic, { qos: mapping.qos ?? 0 }); this.client.on('message', handler); return { unsubscribe: async () => { this.client?.off('message', handler); await this.client?.unsubscribeAsync(mapping.topic); } }; }
}
