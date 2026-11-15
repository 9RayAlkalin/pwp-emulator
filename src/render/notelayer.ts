export type NoteCommand = { op: string; args: any[] };
export class NoteCommands {
  readonly commands: NoteCommand[] = [];
  readonly images: CanvasImageSource[] = [];
  readonly context: CanvasRenderingContext2D;
  constructor() {
    const target: Record<string, any> = {};
    const operations = ['save', 'restore', 'translate', 'rotate', 'scale', 'transform', 'beginPath', 'rect', 'clip', 'setTransform'];
    for (const op of operations) target[op] = (...args: any[]) => this.commands.push({ op, args });
    target.getTransform = () => [1, 0, 0, 1, 0, 0];
    target.setTransform = (...args: any[]) => this.commands.push({ op: 'setTransform', args: Array.isArray(args[0]) ? args[0] : args });
    target.drawCenterRotateImage = (image: CanvasImageSource, ...args: any[]) => {
      let id = this.images.indexOf(image);
      if (id < 0) { id = this.images.length; this.images.push(image); }
      this.commands.push({ op: 'sprite', args: [id, ...args] });
    };
    this.context = new Proxy(target, { set: (object, op: string, value) => {
      object[op] = value; this.commands.push({ op: 'property', args: [op, value] }); return true;
    } }) as CanvasRenderingContext2D;
  }
}

export function replayNotes(context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
                            commands: NoteCommand[], images: CanvasImageSource[]): void {
  for (const { op, args } of commands) {
    if (op === 'property') { (context as any)[args[0]] = args[1]; continue; }
    if (op === 'sprite') {
      const [id, x, y, width, height, degrees, skew = 0, flipY = 1] = args;
      context.save(); context.translate(x, y); context.rotate(degrees * Math.PI / 180);
      if (flipY !== 1) context.scale(1, flipY);
      if (skew) context.transform(1, 0, Math.tan(skew * Math.PI / 180), 1, 0, 0);
      context.drawImage(images[id], -width / 2, -height / 2, width, height); context.restore();
    } else (context as any)[op](...args);
  }
}

export class NoteLayer {
  private worker?: Worker;
  private ids = new WeakMap<object, number>();
  private nextImage = 0;
  private nextFrame = 0;
  private pending?: { id: number; resolve: (image?: ImageBitmap) => void; timer: ReturnType<typeof setTimeout> };
  private disabled = false;
  private busy = false;
  supported(): boolean { return !this.disabled && typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap === 'function'; }
  reset(): void { this.stop(); this.ids = new WeakMap(); this.nextImage = 0; this.disabled = false; }
  private stop(): void {
    this.worker?.terminate(); this.worker = undefined;
    if (this.pending) { clearTimeout(this.pending.timer); this.pending.resolve(); this.pending = undefined; }
  }
  async draw(batch: NoteCommands, width: number, height: number): Promise<ImageBitmap | undefined> {
    if (!this.supported() || this.pending || this.busy) return undefined;
    if (batch.images.length > 256) return undefined;
    const id = ++this.nextFrame;
    this.busy = true;
    try {
      if (!this.worker) {
        this.worker = new Worker(new URL('./noteworker.ts', import.meta.url), { type: 'module' });
        this.worker.onmessage = ({ data }) => {
          const pending = this.pending;
          if (!pending || pending.id !== data.id) { data.image?.close(); return; }
          clearTimeout(pending.timer); this.pending = undefined; pending.resolve(data.image);
        };
        this.worker.onerror = () => { this.disabled = true; this.stop(); };
      }
      // Keep a bound on worker-owned tinted sprites. Recreate the atlas when
      // full; the original main-thread images remain available for replay.
      const missing = batch.images.filter(image => !this.ids.has(image)).length;
      if (this.nextImage + missing > 256) {
        this.reset(); this.busy = false; return this.draw(batch, width, height);
      }
      const worker = this.worker;
      const imageIds: number[] = [];
      for (const source of batch.images) {
        let imageId = this.ids.get(source);
        if (imageId === undefined) {
          const image = await createImageBitmap(source);
          if (worker !== this.worker) { image.close(); return undefined; }
          imageId = this.nextImage++; this.ids.set(source, imageId);
          try { worker.postMessage({ type: 'image', id: imageId, image }, [image]); }
          catch (error) { image.close(); throw error; }
        }
        imageIds.push(imageId);
      }
      return await new Promise(resolve => {
        const timer = setTimeout(() => { this.disabled = true; this.stop(); }, 2000);
        this.pending = { id, resolve, timer };
        try { worker.postMessage({ type: 'frame', id, width, height, commands: batch.commands, imageIds }); }
        catch { this.disabled = true; this.stop(); }
      });
    } catch { this.disabled = true; this.stop(); return undefined; }
    finally { this.busy = false; }
  }
}
