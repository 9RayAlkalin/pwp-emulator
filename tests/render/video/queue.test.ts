import { expect, it, vi } from 'vitest';
import { RenderQueue } from '../../../src/render/video/queue';

it('renders in order, prevents overlapping runs, and continues past a failed item', async () => {
  const queue = new RenderQueue<number, string>(() => {});
  queue.add(1);
  queue.add(2);
  queue.add(3);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const render = vi.fn(async (task: number) => {
    if (task === 1) await gate;
    if (task === 2) throw Error('encoder failed');
    return String(task);
  });

  const pending = queue.run(render);
  await queue.run(render);
  expect(render).toHaveBeenCalledTimes(1);
  release();
  await pending;
  expect(render.mock.calls.map(([task]) => task)).toEqual([1, 2, 3]);
  expect(queue.items).toMatchObject([
    { state: 'done', result: '1' }, { state: 'failed', error: 'encoder failed' }, { state: 'done', result: '3' },
  ]);

  queue.retry(queue.items[1]);
  await queue.run(async task => 'retry ' + task);
  expect(queue.items[1]).toMatchObject({ state: 'done', result: 'retry 2' });
});

it.each([false, true])('cancels the current item with stop=%s', async stop => {
  const queue = new RenderQueue<number, number>(() => {});
  queue.add(1);
  queue.add(2);
  const pending = queue.run(async (task, { signal }) => {
    if (task === 1) await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
    return task;
  });

  if (stop) queue.stop();
  else queue.cancelCurrent();
  await pending;
  expect(queue.items.map(item => item.state)).toEqual(['cancelled', stop ? 'waiting' : 'done']);
  expect(queue.items[0].result).toBeUndefined();
  queue.remove(queue.items[0]);
  expect(queue.items).toHaveLength(1);
});
