export function checkCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new Error('已取消');
}

// MessageChannel also yields when a background tab throttles timers.
export const yieldFrame = () => new Promise<void>(resolve => {
  const channel = new MessageChannel();
  channel.port1.onmessage = () => { channel.port1.close(); channel.port2.close(); resolve(); };
  channel.port2.postMessage(0);
});
