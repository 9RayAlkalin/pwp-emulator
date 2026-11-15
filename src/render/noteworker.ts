import { replayNotes } from './notelayer';

const images = new Map<number, ImageBitmap>();
let canvas: OffscreenCanvas | undefined;
const scope = globalThis as unknown as { onmessage: (event: MessageEvent) => void; postMessage(message: unknown, transfer: Transferable[]): void };
scope.onmessage = ({ data }) => {
  if (data.type === 'image') { images.set(data.id, data.image); return; }
  if (data.type !== 'frame') return;
  canvas ??= new OffscreenCanvas(data.width, data.height);
  if (canvas.width !== data.width) canvas.width = data.width;
  if (canvas.height !== data.height) canvas.height = data.height;
  const context = canvas.getContext('2d')!;
  context.setTransform(1, 0, 0, 1, 0, 0); context.globalAlpha = 1;
  context.clearRect(0, 0, canvas.width, canvas.height);
  replayNotes(context, data.commands, data.imageIds.map((id: number) => images.get(id)!));
  const image = canvas.transferToImageBitmap();
  scope.postMessage({ id: data.id, image }, [image]);
};
