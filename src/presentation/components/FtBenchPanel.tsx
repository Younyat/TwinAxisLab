import { useEffect, useRef, useState } from 'react';
import { FlaskConical, Square } from 'lucide-react';
import { BENCH_HOME, advanceBenchPlant, benchFrame, type BenchPose } from '../../application/twin/ftBenchPlant';
import { decodeFt511938Registers } from '../../application/twin/ft511938PlcContract';
import { recordCommunicationEvent } from '../../infrastructure/observability/communicationTelemetry';

type Props = { host: string; port: number; unitId: number; address: number; online: boolean; enabled: boolean };

export function FtBenchPanel({ host, port, unitId, address, online, enabled }: Props) {
  const [active, setActive] = useState(false);
  const [message, setMessage] = useState('Banco detenido');
  const [pose, setPose] = useState<BenchPose>([...BENCH_HOME]);
  const [frozen, setFrozen] = useState(false);
  const [valid, setValid] = useState(true);
  const [homed, setHomed] = useState(true);
  const [minMask, setMinMask] = useState(0);
  const [maxMask, setMaxMask] = useState(0);
  const [evidence, setEvidence] = useState<{ target: BenchPose; returned: BenchPose; run: number; direction: number; samples: number }>();
  const settings = useRef({ frozen, valid, homed, minMask, maxMask });
  settings.current = { frozen, valid, homed, minMask, maxMask };
  const busy = useRef(false);
  const activeEndpoint = useRef('');
  const endpoint = `${host}:${port}`;
  const endpointKey = `${endpoint}/${unitId}/${address}`;
  const read = async () => {
    const query = new URLSearchParams({ host, port: String(port), unitId: String(unitId), address: String(address), quantity: '61', profile: 'ft511938-unified' });
    const response = await fetch(`/__openplc/read?${query}`, { cache: 'no-store', signal: AbortSignal.timeout(2000) });
    const result = await response.json();
    if (!response.ok || !result.ok || result.registers?.length !== 61) throw new Error(result.error ?? 'Lectura del banco incompleta');
    return decodeFt511938Registers(result.registers);
  };
  const write = async (values: number[]) => {
    const response = await fetch('/__openplc/write', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host, port, unitId, address, values, priority: 'control' }), signal: AbortSignal.timeout(2000) });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error ?? 'Escritura del banco rechazada');
    recordCommunicationEvent({ stage: 'modbus-tx', status: 'ok', source: 'S7 bench controller', destination: endpoint,
      operation: values[0] === 0 ? 'bench STOP requested' : 'bench feedback written', registerRange: `HR0..HR${values.length - 1}`, registers: values });
  };
  const stop = async () => { await write([0, 0, 0, 0, 0]); };
  const start = async () => {
    if (busy.current || active || !online || !enabled || address !== 0) return;
    if (!window.confirm('Banco Cmd=5: solo con actuadores aislados y OB1 revisado. El FB inhibe sus salidas, pero esto no certifica el cableado. Se inicializara la planta virtual en HOME.')) return;
    busy.current = true;
    try {
      setFrozen(false);
      settings.current.frozen = false;
      setEvidence(undefined);
      await stop();
      await new Promise(resolve => setTimeout(resolve, 150));
      const initial = await read();
      if (initial.command !== 0 || initial.enable || initial.physicalOutputEnable || initial.cmdQMask !== 0 || initial.runMask !== 0)
        throw new Error('STOP no confirmado o permiso/salidas fisicas presentes');
      await write(benchFrame([...BENCH_HOME], initial.heartbeatSequence + 1, settings.current.minMask, settings.current.maxMask, settings.current.valid, settings.current.homed));
      // Give a cyclic FB call time to publish its bench acknowledgement.
      await new Promise(resolve => setTimeout(resolve, 100));
      const ack = await read();
      if (ack.command !== 5 || ack.activeMode !== 5 || ack.simulationMode !== 1 || ack.physicalOutputEnable || ack.cmdQMask !== 0)
        throw new Error('Cmd=5 no reconocido: cargar el SCL actualizado; no simular sobre el controlador antiguo');
      setPose([...BENCH_HOME]);
      activeEndpoint.current = endpointKey;
      setActive(true);
      setMessage('Banco activo');
    } catch (error) {
      await stop().catch(() => undefined);
      setMessage(error instanceof Error ? error.message : String(error));
    } finally { busy.current = false; }
  };
  useEffect(() => {
    if (!active) return;
    if (!enabled || activeEndpoint.current !== endpointKey) {
      setActive(false);
      return;
    }
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let current: BenchPose = [...BENCH_HOME];
    let lastAt = performance.now();
    const tick = async () => {
      try {
        let snapshot = await read();
        // A successful FC16 can precede the next PLC scan. Retry the echo,
        // never advance the virtual plant from an unconfirmed position.
        for (let retry = 0; retry < 3 && snapshot.command === 5 && snapshot.positions.some((value, i) => Math.abs(value - current[i]) >= 0.05); retry++) {
          await new Promise(resolve => setTimeout(resolve, 100));
          if (disposed) return;
          snapshot = await read();
        }
        if (disposed) return;
        if (snapshot.command !== 5 || snapshot.activeMode !== 5 || snapshot.simulationMode !== 1 || snapshot.physicalOutputEnable || snapshot.cmdQMask !== 0)
          throw new Error(`Banco detenido: Cmd=${snapshot.command}, modo=${snapshot.activeMode}, simulacion=${snapshot.simulationMode}, permiso fisico=${Number(snapshot.physicalOutputEnable)}, salidas=${snapshot.cmdQMask}. ${snapshot.command === 0 ? 'Se ha observado STOP. No equivale a un fallo de salida fisica.' : 'El PLC no mantiene la identidad Cmd5.'}`);
        if (!snapshot.valid) throw new Error(`Feedback de banco invalido: ${snapshot.validation.join('; ')}`);
        if (!snapshot.commFresh) throw new Error('Watchdog del banco no vigente');
        const feedbackMatches = snapshot.positions.every((value, i) => Math.abs(value - current[i]) < 0.05);
        if (!feedbackMatches) throw new Error('El PLC no publica el feedback enviado en HR6..13');
        if (snapshot.alarmCode && snapshot.runMask) throw new Error('El PLC mantiene marcha con fallo activo');
        snapshot.targets.forEach((target, i) => {
          if (!(snapshot.runMask & (1 << i))) return;
          const delta = target - current[i];
          if (Math.abs(delta) > 0.05 && (delta > 0) !== !!(snapshot.directionMask & (1 << i)))
            throw new Error(`Sentido incoherente en eje ${i + 1}`);
        });
        const now = performance.now();
        const elapsedMs = now - lastAt;
        const previous: BenchPose = [...current];
        current = advanceBenchPlant(current, snapshot.alarmCode ? 0 : snapshot.runMask, snapshot.directionMask, now - lastAt, settings.current.frozen, snapshot.targets);
        const advanced = current.some((value, i) => Math.abs(value - previous[i]) > 0.00001);
        if (snapshot.runMask && !snapshot.alarmCode && !settings.current.frozen && !advanced && now - lastAt > 50)
          throw new Error(`Orden de marcha sin avance virtual: run=${snapshot.runMask}; objetivos=${snapshot.targets.join(',')}; posiciones=${previous.join(',')}. Revisar objetivos y limites de la planta.`);
        lastAt = now;
        const controls = settings.current;
        const frame = benchFrame(current, snapshot.heartbeatSequence + 1, controls.minMask, controls.maxMask, controls.valid, controls.homed);
        await write(frame);
        if (disposed) return;
        setPose([...current]);
        setEvidence(old => ({ target: snapshot.targets, returned: snapshot.positions, run: snapshot.runMask, direction: snapshot.directionMask, samples: (old?.samples ?? 0) + 1 }));
        setMessage(`Paso ${snapshot.activeStep} · alarma ${snapshot.alarmCode} · run ${snapshot.runMask} · ${controls.frozen ? 'FEEDBACK CONGELADO: planta detenida por el operador' : 'feedback confirmado'}`);
        recordCommunicationEvent({ stage: 'plc-decision', status: snapshot.alarmCode ? 'warning' : 'ok', source: 'S7 Cmd5 bench', destination: endpoint,
          operation: 'bench closed-loop verification', protocol: 'Modbus TCP', registerRange: 'HR0..HR13', registers: frame,
          decoded: { step: snapshot.activeStep, alarm: snapshot.alarmCode, feedbackConfirmed: feedbackMatches, runMask: snapshot.runMask, outputMask: snapshot.cmdQMask, physicalOutputsInhibited: !snapshot.physicalOutputEnable },
          metadata: { simulatedFeedback: true, electricalVerification: false, frozen: controls.frozen, advanced, target: snapshot.targets.join(','), returnedPosition: snapshot.positions.join(','), sentPosition: current.join(','), elapsedMs } });
        timer = setTimeout(() => void tick(), 100);
      } catch (error) {
        if (!disposed) {
          const detail = error instanceof Error ? error.message : String(error);
          setMessage(detail);
          recordCommunicationEvent({ stage: 'plc-decision', status: 'error', source: 'S7 Cmd5 bench', destination: endpoint, operation: 'bench stopped', error: detail });
          setActive(false);
        }
      }
    };
    void tick();
    return () => { disposed = true; clearTimeout(timer); void stop().catch(() => undefined); };
    // Endpoint changes dispose the old loop and stop its captured endpoint.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, enabled, endpointKey]);
  return <section aria-label="Banco de pruebas S7" className="ft-bench-panel">
    <h4>Banco S7 · Cmd=5</h4>
    <button type="button" disabled={!enabled || !online || busy.current || address !== 0} onClick={() => active ? setActive(false) : void start()}>
      {active ? <Square size={14} /> : <FlaskConical size={14} />}{active ? 'Detener banco' : 'Iniciar banco'}
    </button>
    <label><input type="checkbox" checked={frozen} onChange={e => setFrozen(e.target.checked)} />Feedback congelado</label>
    <label><input type="checkbox" checked={valid} onChange={e => setValid(e.target.checked)} />Sensor valido</label>
    <label><input type="checkbox" checked={homed} onChange={e => setHomed(e.target.checked)} />Ejes referenciados</label>
    <fieldset><legend>Finales de carrera simulados</legend>
      {[0, 1, 2, 3].map(i => <div key={i}>Eje {i + 1}
        <label><input type="checkbox" checked={!!(minMask & (1 << i))} onChange={e => setMinMask(v => e.target.checked ? v | (1 << i) : v & ~(1 << i))} />Min</label>
        <label><input type="checkbox" checked={!!(maxMask & (1 << i))} onChange={e => setMaxMask(v => e.target.checked ? v | (1 << i) : v & ~(1 << i))} />Max</label>
      </div>)}
    </fieldset>
    <output aria-live="polite">{message}</output>
    <code>Feedback simulado: {pose.map(v => v.toFixed(2)).join(' · ')}</code>
    {evidence && <div aria-label="Evidencia del banco" style={{ width: '100%', overflowX: 'auto' }}>
      <strong>{evidence.samples} intercambios confirmados · respuesta simulada, no sensores fisicos</strong>
      <table style={{ width: '100%', minWidth: 560, fontSize: 13, borderCollapse: 'collapse', textAlign: 'left' }}>
        <thead><tr><th>Eje</th><th>Orden PLC</th><th>Objetivo</th><th>Posicion devuelta</th><th>Feedback enviado</th></tr></thead>
        <tbody>{pose.map((value, i) => <tr key={i}><td>{i + 1}</td><td>{evidence.run & (1 << i) ? evidence.direction & (1 << i) ? 'Marcha +' : 'Marcha -' : 'Parado'}</td><td>{evidence.target[i].toFixed(2)}</td><td>{evidence.returned[i].toFixed(2)}</td><td>{value.toFixed(2)}</td></tr>)}</tbody>
      </table>
    </div>}
  </section>;
}
