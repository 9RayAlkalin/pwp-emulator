import { expect, it, vi } from 'vitest';
import { GeometryPipeline, geometryWorkerCount, type GeometryWorker } from '../../src/render/geometry';
import { createGeometryPreparer, type PreparedChart } from '../../src/chart/geometry/prepare';
import { emptyLine } from '../../src/chart/formats/compiler';
import { init_speed_events } from '../../src/chart/animation/timeline';
import { chartNoteGeometry } from '../../src/chart/geometry/notes';

function chart(): PreparedChart {
  const line = emptyLine();
  line.speedEvents = [{ startTime: 0, endTime: 100, value: 1 }]; init_speed_events(line.speedEvents);
  line.animation = { x: [], y: [], rotation: [], alpha: [], cover: false, zOrder: 0,
    controls: { y: [{ x: 0, value: 1, easing: 1 }, { x: 1000, value: 2, easing: 5 }] } };
  return { sourceFormat: 'rpe', lines: [line], notes: [{ line: 0, above: true,
    note: { type: 1, time: 2, holdTime: 0, positionX: 1, speed: 1, floorPosition: 2 } }] };
}
class FakeWorker implements GeometryWorker {
  onmessage: GeometryWorker['onmessage'] = null;
  onerror: GeometryWorker['onerror'] = null;
  messages: any[] = [];
  stopped = false;
  transfers: Transferable[][] = [];
  postMessage(message: unknown, transfer: Transferable[] = []) { this.messages.push(message); this.transfers.push(transfer); }
  terminate() { this.stopped = true; }
  reply(request: any, data = chart()) {
    this.onmessage?.({ data: { generation: request.generation, id: request.id,
      frame: createGeometryPreparer(data)(request.time, request.aspect) } } as MessageEvent);
  }
}

it('prepares identical geometry with reusable arrays across reverse seeks', () => {
  const data = chart(), prepare = createGeometryPreparer(data);
  let previous = prepare(1, 16 / 9);
  for (const time of [1.5, .25, 2]) {
    const frame = prepare(time, 16 / 9, previous.lines, previous.notes);
    expect(frame.lines).toBe(previous.lines); expect(frame.notes).toBe(previous.notes);
    const reference = chartNoteGeometry(data.notes[0].note, data.lines[0].animation, time, (2 - time) * .6 * 900);
    expect(Array.from(frame.notes)).toEqual([reference.x, reference.y, reference.size, reference.alpha, reference.skew]);
    previous = frame;
  }
});

it('bounds pool size by cores, workload and the four-worker limit', () => {
  expect(geometryWorkerCount(10000, 16)).toBe(4);
  expect(geometryWorkerCount(10000, 2)).toBe(1);
  expect(geometryWorkerCount(513, 8)).toBe(2);
  expect(geometryWorkerCount(0, NaN)).toBe(1);
});

it('merges out-of-order shards in registration order and recycles their own buffers', async () => {
  const workers: FakeWorker[] = [];
  const pipeline = new GeometryPipeline(() => { const worker = new FakeWorker(); workers.push(worker); return worker; }, 8);
  const data = chart(), first = data.notes[0];
  data.notes = Array.from({ length: 1537 }, (_, i) => ({ ...first, note: { ...first.note, positionX: i / 100 } }));
  pipeline.load(data); expect(workers).toHaveLength(4);
  const pending = pipeline.exact(1, 16 / 9);
  const expected = createGeometryPreparer(data)(1, 16 / 9);
  const replies = workers.map(worker => ({ request: worker.messages.at(-1), data: worker.messages[0].chart }));
  for (const index of [3, 1, 1, 0, 2]) workers[index].reply(replies[index].request, replies[index].data);
  await pending;
  const result = pipeline.frame(1, 16 / 9)!;
  expect(result.notes).toEqual(expected.notes); expect(result.lines).toEqual(expected.lines);
  const next = pipeline.exact(.25, 4 / 3);
  workers.forEach((worker, i) => {
    expect(worker.transfers.at(-1)).toHaveLength(2);
    worker.reply(worker.messages.at(-1), replies[i].data);
  });
  await next;
  expect(pipeline.frame(.25, 4 / 3)).toBe(result);
  expect(result.notes).toEqual(createGeometryPreparer(data)(.25, 4 / 3).notes);
  pipeline.dispose(); expect(workers.every(worker => worker.stopped)).toBe(true);
});

it('discards partial pool results on any shard failure and resolves waiting callers', async () => {
  const workers: FakeWorker[] = [];
  const pipeline = new GeometryPipeline(() => { const worker = new FakeWorker(); workers.push(worker); return worker; }, 4);
  const data = chart(); data.notes = Array.from({ length: 1024 }, () => data.notes[0]);
  pipeline.load(data);
  const first = pipeline.exact(1, 1), second = pipeline.exact(2, 1);
  workers[0].reply(workers[0].messages.at(-1), workers[0].messages[0].chart);
  workers[1].onerror?.(new Event('error'));
  await Promise.all([first, second]);
  expect(workers.every(worker => worker.stopped)).toBe(true);
  expect(pipeline.frame(2, 1)?.notes).toEqual(createGeometryPreparer(data)(2, 1).notes);
  pipeline.dispose();
});

it('serializes callers at different timestamps rather than returning the preceding frame', async () => {
  const worker = new FakeWorker(), pipeline = new GeometryPipeline(() => worker);
  pipeline.load(chart());
  const first = pipeline.exact(1, 1), second = pipeline.exact(2, 1);
  expect(worker.messages).toHaveLength(2);
  worker.reply(worker.messages.at(-1)); await first;
  await Promise.resolve();
  expect(worker.messages.at(-1).time).toBe(2);
  worker.reply(worker.messages.at(-1)); await second;
  expect(pipeline.frame(2, 1)?.time).toBe(2);
  pipeline.dispose();
});

it('terminates an unresponsive pool and resolves the frame with synchronous fallback', async () => {
  vi.useFakeTimers();
  const worker = new FakeWorker(), pipeline = new GeometryPipeline(() => worker);
  try {
    pipeline.load(chart());
    const pending = pipeline.exact(1, 1);
    await vi.advanceTimersByTimeAsync(2000); await pending;
    expect(worker.stopped).toBe(true);
    expect(pipeline.frame(1, 1)?.time).toBe(1);
  } finally { pipeline.dispose(); vi.useRealTimers(); }
});

it('uses exact worker timestamps, rejects old generations and falls back after worker failure', async () => {
  const worker = new FakeWorker(), pipeline = new GeometryPipeline(() => worker);
  pipeline.load(chart());
  const pending = pipeline.exact(1, 16 / 9), request = worker.messages.at(-1);
  worker.reply(request); await pending;
  expect(pipeline.frame(1, 16 / 9)?.time).toBe(1);
  expect(pipeline.frame(.25, 4 / 3)?.time).toBe(.25);
  const old = pipeline.exact(3, 16 / 9), oldRequest = worker.messages.at(-1);
  pipeline.load(chart()); await old;
  const fresh = pipeline.exact(2, 16 / 9), freshRequest = worker.messages.at(-1);
  worker.reply(oldRequest);
  worker.reply(freshRequest); await fresh;
  expect(pipeline.frame(2, 16 / 9)?.time).toBe(2);
  const failed = pipeline.exact(4, 16 / 9);
  worker.onerror?.(new Event('error')); await failed;
  expect(worker.stopped).toBe(true);
  expect(pipeline.frame(4, 16 / 9)?.time).toBe(4);
  pipeline.dispose(); expect(pipeline.frame(0, 1)).toBeUndefined();
});

it('keeps small live charts synchronous and tolerates unavailable workers', async () => {
  const worker = new FakeWorker(), pipeline = new GeometryPipeline(() => worker);
  pipeline.load(chart()); await pipeline.exact(1, 1, true);
  expect(worker.messages).toHaveLength(1);
  pipeline.dispose();
  const fallback = new GeometryPipeline(() => { throw new Error('blocked'); });
  fallback.load(chart()); await fallback.exact(1, 1);
  expect(fallback.frame(1, 1)?.time).toBe(1);
  fallback.dispose();
});
