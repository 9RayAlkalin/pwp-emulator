import { simulator } from './runtime';

export function bindInput(canvas: HTMLCanvasElement): void {
  // Pointer capture alone does not stop the browser cancelling a drag to scroll.
  canvas.style.touchAction = 'none';
  const position = (event: PointerEvent): [number, number] => {
    const rect = canvas.getBoundingClientRect();
    return [(event.clientX - rect.left) / rect.width * canvas.width, (event.clientY - rect.top) / rect.height * canvas.height];
  };
  canvas.addEventListener('pointerdown', event => {
    // Keep the HUD pause control outside the judgement area.
    const [x, y] = position(event);
    if (y < canvas.height * 0.1 && x < canvas.width * 0.1) return;
    event.preventDefault(); canvas.setPointerCapture(event.pointerId);
    simulator.hit(String(event.pointerId), x, y, 'tap');
  });
  canvas.addEventListener('pointermove', event => {
    if (!canvas.hasPointerCapture(event.pointerId)) return;
    simulator.hit(String(event.pointerId), ...position(event), 'move');
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    canvas.addEventListener(type, event => {
      const pointer = event as PointerEvent;
      simulator.hit(String(pointer.pointerId), ...position(pointer), 'release');
    });
  }
  const keys = new Set(['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyJ', 'KeyK', 'KeyN', 'KeyM']);
  window.addEventListener('keydown', event => {
    if (!keys.has(event.code) || event.repeat || event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
    event.preventDefault(); simulator.hit(event.code, 0, 0, 'tap', true);
  });
  window.addEventListener('keyup', event => {
    if (keys.has(event.code)) simulator.hit(event.code, 0, 0, 'release', true);
  });
  window.addEventListener('blur', () => { simulator.pause(); simulator.clearInput(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { simulator.pause(); simulator.clearInput(); }
  });
}
