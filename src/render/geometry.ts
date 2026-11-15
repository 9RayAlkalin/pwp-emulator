import { createGeometryPreparer, type GeometryFrame, type PreparedChart } from '../chart/geometry/prepare';

export interface GeometryWorker {
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
}
export type GeometryReply = { generation: number; id: number; frame: GeometryFrame };
interface Slot { worker: GeometryWorker; start: number; count: number; frame?: GeometryFrame; received: boolean; }
interface Pending {
  id: number; time: number; aspect: number; remaining: number;
  resolve: () => void; timer: ReturnType<typeof setTimeout>; promise: Promise<void>;
}

export function geometryWorkerCount(notes: number, cores: number): number {
  const available = Number.isFinite(cores) ? Math.max(1, Math.floor(cores) - 1) : 1;
  return Math.max(1, Math.min(4, available, Math.ceil(notes / 512)));
}

// One frame in flight across the whole pool. Shards retain original note order;
// no partial result can reach Canvas. Worker failures disable the entire pool.
export class GeometryPipeline {
  private slots: Slot[] = [];
  private generation = 0;
  private nextId = 0;
  private pending?: Pending;
  private ready?: GeometryFrame;
  private chart?: PreparedChart;
  private prepare?: ReturnType<typeof createGeometryPreparer>;
  private sync?: GeometryFrame;
  constructor(private readonly factory: () => GeometryWorker | undefined = () => typeof Worker === 'undefined' ? undefined :
    new Worker(new URL('./geometryworker.ts', import.meta.url), { type: 'module' }),
    private readonly cores = typeof navigator === 'undefined' ? 2 : navigator.hardwareConcurrency) {}

  load(chart: PreparedChart): void {
    this.dispose(); this.chart = chart; this.prepare = createGeometryPreparer(chart);
    try {
      const count = geometryWorkerCount(chart.notes.length, this.cores);
      for (let index = 0; index < count; index++) {
        const worker = this.factory();
        if (!worker) { this.disable(); return; }
        const start = Math.floor(chart.notes.length * index / count), end = Math.floor(chart.notes.length * (index + 1) / count);
        const slot: Slot = { worker, start, count: end - start, received: false };
        this.slots.push(slot);
        worker.onmessage = ({ data }: MessageEvent<GeometryReply>) => this.receive(slot, data);
        worker.onerror = () => this.disable();
        worker.postMessage({ type: 'load', generation: this.generation, chart: {
          sourceFormat: chart.sourceFormat, lines: chart.lines, notes: chart.notes.slice(start, end)
        } });
      }
    } catch { this.disable(); }
  }
  private receive(slot: Slot, data: GeometryReply): void {
    const pending = this.pending;
    if (!pending || data.generation !== this.generation || data.id !== pending.id || slot.received) return;
    const frame = data.frame;
    if (frame.time !== pending.time || frame.aspect !== pending.aspect ||
        frame.lines.length !== this.chart!.lines.length * 5 || frame.notes.length !== slot.count * 5) {
      this.disable(); return;
    }
    slot.frame = frame; slot.received = true;
    if (--pending.remaining !== 0) return;
    // Reuse the combined output; the shard arrays remain separate transferable
    // buffers and are returned to their owning workers on the next request.
    const output = this.ready ?? {
      time: frame.time, aspect: frame.aspect,
      lines: new Float64Array(frame.lines.length), notes: new Float64Array(this.chart!.notes.length * 5)
    };
    output.time = frame.time; output.aspect = frame.aspect;
    output.lines.set(this.slots[0].frame!.lines);
    for (const shard of this.slots) output.notes.set(shard.frame!.notes, shard.start * 5);
    this.ready = output;
    clearTimeout(pending.timer); this.pending = undefined; pending.resolve();
  }
  private disable(): void {
    for (const { worker } of this.slots) worker.terminate();
    this.slots = [];
    if (this.pending) { clearTimeout(this.pending.timer); this.pending.resolve(); this.pending = undefined; }
    this.ready = undefined;
  }
  dispose(): void {
    this.generation++; this.disable(); this.chart = undefined; this.prepare = undefined; this.sync = undefined;
  }
  private request(time: number, aspect: number): Promise<void> {
    if (!this.slots.length) return Promise.resolve();
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    const id = ++this.nextId, timer = setTimeout(() => this.disable(), 2000);
    this.pending = { id, time, aspect, remaining: this.slots.length, resolve, timer, promise };
    try {
      for (const slot of this.slots) {
        const previous = slot.frame; slot.frame = undefined; slot.received = false;
        slot.worker.postMessage({ type: 'frame', generation: this.generation, id, time, aspect,
          lines: previous?.lines, notes: previous?.notes }, previous ? [previous.lines.buffer as ArrayBuffer, previous.notes.buffer as ArrayBuffer] : []);
      }
    } catch { this.disable(); }
    return promise;
  }
  frame(time: number, aspect: number): GeometryFrame | undefined {
    if (this.ready?.time === time && this.ready.aspect === aspect) return this.ready;
    if (!this.prepare) return undefined;
    this.sync = this.prepare(time, aspect, this.sync?.lines, this.sync?.notes);
    return this.sync;
  }
  async exact(time: number, aspect: number, live = false): Promise<void> {
    if (live && (this.chart?.notes.length ?? 0) < 512) return;
    const generation = this.generation;
    // A concurrent caller must wait for the old frame, then request its own
    // timestamp instead of silently taking the synchronous path.
    while (this.pending) {
      await this.pending.promise;
      if (generation !== this.generation) return;
    }
    if (this.ready?.time === time && this.ready.aspect === aspect) return;
    await this.request(time, aspect);
  }
}
