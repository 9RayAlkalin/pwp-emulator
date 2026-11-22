const storageKey = 'pwp.export';
const settingIds = [
  'exp-backend', 'exp-codec', 'exp-container', 'exp-rate-control', 'exp-crf', 'exp-preset',
  'exp-pixel-format', 'exp-prores-profile', 'exp-audio-codec', 'exp-threading', 'exp-threads',
  'exp-browser-codec', 'exp-hardware', 'exp-w', 'exp-h', 'exp-fps', 'exp-bitrate',
  'exp-keyframe', 'exp-audio-bitrate', 'exp-audio', 'exp-loading', 'exp-result', 'exp-result-seconds',
];

type SettingField = HTMLInputElement | HTMLSelectElement;

function validValue(field: SettingField, value: unknown): value is string | boolean {
  if (field.type === 'checkbox') return typeof value === 'boolean';
  if (typeof value !== 'string') return false;
  if (field instanceof HTMLSelectElement) return Array.from(field.options).some(option => option.value === value);
  if (field.id === 'exp-bitrate' && (value === '' || value === '0')) return true;
  const number = Number(value);
  return value.trim() !== '' && Number.isFinite(number) && number >= Number(field.min) && number <= Number(field.max);
}

export function bindExportSettings(dialog: HTMLDialogElement): () => void {
  const fields = settingIds.map(id => dialog.querySelector<SettingField>('#' + id)!).filter(Boolean);
  const values: Record<string, string | boolean> = {};
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
    for (const field of fields) {
      const value = saved?.[field.id];
      if (!validValue(field, value)) continue;
      if (field instanceof HTMLInputElement && typeof value === 'boolean') field.checked = value;
      else if (typeof value === 'string') field.value = value;
      values[field.id] = value;
    }
  } catch { /* Storage may be unavailable or malformed. */ }

  const save = () => {
    for (const field of fields) {
      const value = field instanceof HTMLInputElement && field.type === 'checkbox' ? field.checked : field.value;
      if (validValue(field, value)) values[field.id] = value;
    }
    try { localStorage.setItem(storageKey, JSON.stringify(values)); } catch { /* Storage may be unavailable. */ }
  };
  const tracked = new Set<EventTarget>(fields);
  dialog.addEventListener('change', event => { if (tracked.has(event.target!)) save(); });
  dialog.addEventListener('input', event => {
    const field = event.target;
    if (field instanceof HTMLInputElement && field.type === 'number' && tracked.has(field)) save();
  });
  return save;
}
