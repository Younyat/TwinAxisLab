import type { DataQuality, SignalBinding, TwinProperty, TwinSignalValue } from '../../domain/twin';
import { applyEngineeringTransform, invertEngineeringTransform } from './dataBus';
import type { ProtocolAdapterRegistry, ProtocolReadResult } from './protocolAdapter';

export type TwinAxisRuntimeSnapshot = {
  properties: Record<string, TwinProperty>;
  bindings: Record<string, SignalBinding>;
  sequence: number;
  updatedAtUtc: string;
};

export type PropertyUpdateListener = (property: TwinProperty, binding: SignalBinding, result: ProtocolReadResult) => void;

const numeric = (value: TwinSignalValue) => typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const rangeQuality = (property: TwinProperty, value: TwinSignalValue, quality: DataQuality): DataQuality => {
  const number = numeric(value);
  if (number === undefined || !property.range) return quality;
  if (property.range.min !== undefined && number < property.range.min) return 'OUT_OF_RANGE';
  if (property.range.max !== undefined && number > property.range.max) return 'OUT_OF_RANGE';
  return quality;
};

export class TwinAxisRuntime {
  private snapshot: TwinAxisRuntimeSnapshot;
  private readonly listeners = new Set<PropertyUpdateListener>();

  constructor(properties: TwinProperty[], bindings: SignalBinding[], private readonly adapters: ProtocolAdapterRegistry) {
    this.snapshot = {
      properties: Object.fromEntries(properties.map((property) => [property.id, { ...property }])),
      bindings: Object.fromEntries(bindings.map((binding) => [binding.id, { ...binding }])),
      sequence: 0,
      updatedAtUtc: new Date(0).toISOString(),
    };
  }

  state() {
    return this.snapshot;
  }

  onPropertyUpdate(listener: PropertyUpdateListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private apply(binding: SignalBinding, result: ProtocolReadResult) {
    const current = this.snapshot.properties[binding.propertyId];
    if (!current) throw new Error(`SignalBinding ${binding.id} targets unknown TwinProperty ${binding.propertyId}.`);
    const value = applyEngineeringTransform(result.value, binding.transform);
    const property = { ...current, value, quality: rangeQuality(current, value, result.quality), timestampUtc: result.timestampUtc };
    const nextBinding = { ...binding, status: property.quality === 'GOOD' ? 'READING' as const : 'BAD_QUALITY' as const };
    this.snapshot = {
      properties: { ...this.snapshot.properties, [property.id]: property },
      bindings: { ...this.snapshot.bindings, [binding.id]: nextBinding },
      sequence: this.snapshot.sequence + 1,
      updatedAtUtc: result.timestampUtc,
    };
    this.listeners.forEach((listener) => listener(property, nextBinding, result));
    return property;
  }

  async read(bindingId: string) {
    const binding = this.snapshot.bindings[bindingId];
    if (!binding?.enabled) throw new Error(`SignalBinding ${bindingId} is disabled or missing.`);
    if (binding.direction === 'WRITE') throw new Error(`SignalBinding ${bindingId} is write-only.`);
    const adapter = this.adapters.get(binding.connectionId, binding.protocol);
    if (!adapter) throw new Error(`No ${binding.protocol} ProtocolAdapter registered for ${binding.connectionId}.`);
    return this.apply(binding, await adapter.read(binding));
  }

  async write(propertyId: string, value: TwinSignalValue, confirmed = false) {
    const property = this.snapshot.properties[propertyId];
    if (!property?.writable) throw new Error(`TwinProperty ${propertyId} is not writable.`);
    if (property.requiresConfirmation && !confirmed) throw new Error(`TwinProperty ${propertyId} requires confirmation.`);
    const number = numeric(value);
    const range = property.safeRange ?? property.range;
    if (number !== undefined && ((range?.min !== undefined && number < range.min) || (range?.max !== undefined && number > range.max))) throw new Error(`TwinProperty ${propertyId} value is outside its safe range.`);
    const binding = Object.values(this.snapshot.bindings).find((item) => item.propertyId === propertyId && item.enabled && item.direction !== 'READ');
    if (!binding) throw new Error(`TwinProperty ${propertyId} has no writable SignalBinding.`);
    const adapter = this.adapters.get(binding.connectionId, binding.protocol);
    if (!adapter) throw new Error(`No ${binding.protocol} ProtocolAdapter registered for ${binding.connectionId}.`);
    const result = await adapter.write(binding, invertEngineeringTransform(value, binding.transform));
    return this.apply(binding, result);
  }
}
