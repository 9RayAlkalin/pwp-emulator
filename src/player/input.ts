import { simulator } from './runtime';

export function bindInput(canvas: HTMLCanvasElement): void {
  // Pointer capture alone does not stop the browser cancelling a drag to scroll.
  canvas.style.touchAction = 'none';
  canvas.addEventListener('contextmenu', event => event.preventDefault());
  const rejectRightButton = (event: MouseEvent): boolean => {
    if (event.button !== 2) return false;
    event.preventDefault();
    return true;
  };
  canvas.addEventListener('auxclick', rejectRightButton);
  const position = (event: PointerEvent): [number, number] => {
    const rect = canvas.getBoundingClientRect();
    return [(event.clientX - rect.left) / rect.width * canvas.width, (event.clientY - rect.top) / rect.height * canvas.height];
  };
  canvas.addEventListener('pointerdown', event => {
    if (rejectRightButton(event)) return;
    // Keep the HUD pause control outside the judgement area.
    const [x, y] = position(event);
    if (y < canvas.height * 0.1 && x < canvas.width * 0.1) return;
    event.preventDefault(); canvas.setPointerCapture(event.pointerId);
    simulator.hit(String(event.pointerId), x, y, 'tap');
  });
  canvas.addEventListener('pointermove', event => {
    if (rejectRightButton(event)) return;
    if (!canvas.hasPointerCapture(event.pointerId)) return;
    simulator.hit(String(event.pointerId), ...position(event), 'move');
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    canvas.addEventListener(type, event => {
      const pointer = event as PointerEvent;
      // A right click never starts a contact. Still clean up a captured left
      // contact if a multi-button mouse gesture ends with the right button.
      if (rejectRightButton(pointer) && !canvas.hasPointerCapture(pointer.pointerId)) return;
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
  window.addEventListener('blur', simulator.pauseOnFocusLoss);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) simulator.pauseOnFocusLoss();
  });
}
