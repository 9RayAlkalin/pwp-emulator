export interface QueueItem<Task, Result> {
  readonly task: Task;
  state: 'waiting' | 'running' | 'done' | 'failed' | 'cancelled';
  result?: Result;
  error?: string;
}

export class RenderQueue<Task, Result> {
  private readonly entries: QueueItem<Task, Result>[] = [];
  private current?: AbortController;
  private stopped = false;
  running = false;

  constructor(private readonly changed: () => void) {}

  get items(): readonly QueueItem<Task, Result>[] { return this.entries; }

  add(task: Task): void {
    this.entries.push({ task, state: 'waiting' });
    this.changed();
  }

  remove(item: QueueItem<Task, Result>): void {
    const index = this.entries.indexOf(item);
    if (index < 0 || item.state === 'running') return;
    this.entries.splice(index, 1);
    this.changed();
  }

  retry(item: QueueItem<Task, Result>): void {
    if (!this.entries.includes(item) || (item.state !== 'failed' && item.state !== 'cancelled')) return;
    item.state = 'waiting';
    item.error = undefined;
    this.changed();
  }

  cancelCurrent(): void { this.current?.abort(); }

  stop(): void {
    this.stopped = true;
    this.cancelCurrent();
  }

  async run(render: (task: Task, controller: AbortController) => Promise<Result>): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.stopped = false;
    try {
      while (!this.stopped) {
        const item = this.entries.find(entry => entry.state === 'waiting');
        if (!item) break;
        const controller = new AbortController();
        this.current = controller;
        item.state = 'running';
        this.changed();
        try {
          const result = await render(item.task, controller);
          if (controller.signal.aborted) item.state = 'cancelled';
          else { item.result = result; item.state = 'done'; }
        } catch (error) {
          if (controller.signal.aborted) item.state = 'cancelled';
          else {
            item.state = 'failed';
            item.error = error instanceof Error ? error.message : String(error);
          }
        } finally {
          this.current = undefined;
          this.changed();
        }
      }
    } finally {
      this.running = false;
      this.changed();
    }
  }
}
