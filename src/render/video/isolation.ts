export const isolationWorkerName = 'isolation-service-worker.js';

export async function toggleIsolation(): Promise<void> {
  if (!('serviceWorker' in navigator)) throw new Error('浏览器不支持 Service Worker，需通过 HTTPS 或 localhost 打开');
  const workerURL = new URL(isolationWorkerName, new URL(import.meta.env.BASE_URL, document.baseURI));
  if (navigator.serviceWorker.controller?.scriptURL === workerURL.href) {
    const registration = await navigator.serviceWorker.getRegistration(workerURL.href);
    await registration?.unregister(); location.reload(); return;
  }
  await navigator.serviceWorker.register(workerURL.href, { scope: new URL('./', workerURL).href });
  await navigator.serviceWorker.ready;
  if (!navigator.serviceWorker.controller) await new Promise<void>(resolve => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }));
  location.reload();
}
