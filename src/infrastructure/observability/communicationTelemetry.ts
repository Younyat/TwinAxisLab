export type CommunicationProbeStage =
  | 'iot-rx'
  | 'modbus-tx'
  | 'plc-rx'
  | 'plc-decision'
  | 'joint-registers'
  | 'kinematic-apply'
  | 'connection';

export type CommunicationProbeStatus = 'ok' | 'warning' | 'error' | 'offline';

export type CommunicationProbeEvent = {
  schemaVersion: 1;
  id: string;
  sessionId: string;
  sequence: number;
  timestampUtc: string;
  stage: CommunicationProbeStage;
  status: CommunicationProbeStatus;
  source: string;
  destination: string;
  operation: string;
  latencyMs?: number;
  correlationId?: string;
  endpoint?: string;
  protocol?: string;
  registerRange?: string;
  registers?: number[];
  decoded?: Record<string, number | string | boolean | null>;
  joints?: number[];
  error?: string;
  metadata?: Record<string, string | number | boolean | null>;
};

export type CommunicationTelemetrySnapshot = {
  sessionId: string;
  storagePath: string;
  events: CommunicationProbeEvent[];
  pending: number;
  persisted: number;
  persistence: 'ready' | 'flushing' | 'offline';
  lastError?: string;
};

type Listener = (snapshot: CommunicationTelemetrySnapshot) => void;
const MAX_EVENTS = 1000;
const MAX_PENDING = 250;
const createSessionId = () => `session-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 8)}`;
let sessionId = createSessionId();
const listeners = new Set<Listener>();
const events: CommunicationProbeEvent[] = [];
const pending: CommunicationProbeEvent[] = [];
const lastByKey = new Map<string, number>();
let sequence = 0;
let persisted = 0;
let persistence: CommunicationTelemetrySnapshot['persistence'] = 'ready';
let lastError: string | undefined;
let flushTimer: ReturnType<typeof setTimeout> | undefined;
let flushing = false;
let recordingEnabled = false;

const resetCaptureSession = () => {
  sessionId = createSessionId();
  storagePath = `project-telemetry/${sessionId}/events.ndjson`;
  events.length = 0;
  pending.length = 0;
  lastByKey.clear();
  sequence = 0;
  persisted = 0;
  lastError = undefined;
  persistence = 'ready';
};

export let storagePath = `project-telemetry/${sessionId}/events.ndjson`;
const publish = () => listeners.forEach((listener) => listener(getCommunicationTelemetrySnapshot()));
const scheduleFlush = (delay = 500) => {
  if (flushTimer || typeof window === 'undefined') return;
  flushTimer = setTimeout(() => void flush(), delay);
};
const flush = async () => {
  flushTimer = undefined;
  if (flushing || pending.length === 0 || typeof fetch === 'undefined') return;
  flushing = true;
  persistence = 'flushing';
  publish();
  const batch = pending.splice(0, Math.min(pending.length, 80));
  try {
    const response = await fetch('/__observability/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId, events: batch }) });
    if (!response.ok) throw new Error(`Observability storage HTTP ${response.status}`);
    persisted += batch.length;
    persistence = 'ready';
    lastError = undefined;
  } catch (error) {
    pending.unshift(...batch);
    persistence = 'offline';
    lastError = error instanceof Error ? error.message : 'Observability storage unavailable';
  } finally {
    flushing = false;
    publish();
    if (recordingEnabled && pending.length > 0) scheduleFlush(3000);
  }
};

/** Repository persistence is opt-in; live in-memory diagnostics remain available while it is off. */
export const setCommunicationTelemetryRecording = (enabled: boolean) => {
  if (enabled === recordingEnabled) return;
  if (enabled) resetCaptureSession();
  recordingEnabled = enabled;
  if (!enabled) void flush();
  publish();
};

export const isCommunicationTelemetryRecording = () => recordingEnabled;

export const recordCommunicationEvent = (input: Omit<CommunicationProbeEvent, 'schemaVersion' | 'id' | 'sessionId' | 'sequence' | 'timestampUtc'> & { dedupeKey?: string; minIntervalMs?: number }) => {
  const now = Date.now();
  if (input.dedupeKey) {
    const previous = lastByKey.get(input.dedupeKey);
    if (previous && now - previous < (input.minIntervalMs ?? 1000)) return;
    lastByKey.set(input.dedupeKey, now);
  }
  const { dedupeKey: _dedupeKey, minIntervalMs: _minIntervalMs, ...payload } = input;
  const event: CommunicationProbeEvent = { schemaVersion: 1, id: `${sessionId}-${sequence + 1}`, sessionId, sequence: ++sequence, timestampUtc: new Date(now).toISOString(), ...payload };
  events.push(event);
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
  if (pending.length >= MAX_PENDING) pending.shift();
  if (recordingEnabled) pending.push(event);
  publish();
  scheduleFlush();
  return event;
};
export const getCommunicationTelemetrySnapshot = (): CommunicationTelemetrySnapshot => ({ sessionId, storagePath, events: [...events], pending: pending.length, persisted, persistence, lastError });
export const subscribeCommunicationTelemetry = (listener: Listener) => { listeners.add(listener); listener(getCommunicationTelemetrySnapshot()); return () => { listeners.delete(listener); }; };
export const flushCommunicationTelemetry = () => flush();
