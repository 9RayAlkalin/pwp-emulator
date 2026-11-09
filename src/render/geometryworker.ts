import { createGeometryPreparer, type PreparedChart } from '../chart/geometry/prepare';

let generation = -1;
let prepare: ReturnType<typeof createGeometryPreparer> | undefined;
const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent) => void;
  postMessage(message: unknown, transfer: Transferable[]): void;
};
scope.onmessage = ({ data }) => {
  if (data.type === 'load') {
    generation = data.generation; prepare = createGeometryPreparer(data.chart as PreparedChart);
  } else if (data.type === 'frame' && generation === data.generation && prepare) {
    const frame = prepare(data.time, data.aspect, data.lines, data.notes);
    scope.postMessage({ generation, id: data.id, frame }, [frame.lines.buffer as ArrayBuffer, frame.notes.buffer as ArrayBuffer]);
  }
};
