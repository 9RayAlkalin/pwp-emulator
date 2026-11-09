import { simulator } from './player/runtime';
import { bindInput } from './player/input';
import { importFiles } from './chart/import/importer';
import { loadSettings, saveSettings } from './app/settings';
import type { ChartInfo } from './chart/types';
import type { LibraryEntry, LocalChart } from './chart/import/types';
import type { Settings } from './app/settings';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const asset = (path: string) => new URL(path.replace(/^\/+/, ''), new URL(import.meta.env.BASE_URL, document.baseURI)).href;
let settings = loadSettings();
let entries: LibraryEntry[] = [];
const localCharts = new Map<string, LocalChart>();
let busy = false;
let ready = false;

function status(text: string): void {
  $('toast').textContent = text;
  $('toast').hidden = !text;
}
function setBusy(value: boolean): void {
  busy = value;
  $<HTMLFieldSetElement>('chart-info').disabled = value || !simulator.snapshot().loaded;
  for (const id of ['file-input', 'chart-select', 'load-chart']) {
    ($<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>(id)).disabled = value || !ready;
  }
}
function updateSettings(patch: Partial<Settings>): void {
  if (simulator.snapshot().exporting) return;
  if (typeof patch.playerName === 'string') patch.playerName = patch.playerName.trim().slice(0, 20) || '9RayAlkalin';
  if (typeof patch.playerId === 'string') patch.playerId = patch.playerId.replace(/\D/g, '').slice(0, 12).padStart(8, '0');
  if (typeof patch.playerChallengeModeRank === 'number') patch.playerChallengeModeRank = Math.round(Math.min(99, Math.max(0, patch.playerChallengeModeRank)));
  settings = { ...settings, ...patch };
  simulator.configure(settings);
  saveSettings(settings);
  syncSettings();
}
function syncSettings(): void {
  $<HTMLInputElement>('autoplay').checked = settings.autoplay;
  $<HTMLSelectElement>('speed').value = String(settings.speed);
  for (const input of document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-setting]')) {
    const key = input.dataset.setting as keyof Settings;
    if (input instanceof HTMLInputElement && input.type === 'checkbox') input.checked = settings[key] as boolean;
    else input.value = String(settings[key]);
    const output = input.parentElement?.querySelector('output');
    if (output) output.textContent = `${Math.round(Number(settings[key]) * 100)}%`;
  }
  $('collection-data-options').hidden = settings.collectionType !== 'data';
  $('collection-item-options').hidden = settings.collectionType === 'data';
}
function renderLibrary(): void {
  const query = $<HTMLInputElement>('search').value.trim().toLocaleLowerCase();
  const filter = $<HTMLSelectElement>('filter').value;
  const select = $<HTMLSelectElement>('chart-select');
  const selected = select.value;
  const shown = entries.filter(entry => (!filter || (filter === 'LOCAL' ? localCharts.has(entry.path) : entry.difficulty === filter)) &&
    [entry.name, entry.composer, entry.charter, entry.level].join(' ').toLocaleLowerCase().includes(query));
  select.replaceChildren(...shown.map(entry => new Option(`${entry.name} — ${entry.level}`, entry.path)));
  if (shown.some(entry => entry.path === selected)) select.value = selected;
  $('catalog-count').textContent = `${shown.length} / ${entries.length}`;
  $<HTMLButtonElement>('load-chart').disabled = busy || !ready || !shown.length;
}
async function loadSelected(): Promise<void> {
  if (busy || !ready || simulator.snapshot().exporting) return;
  const entry = entries.find(item => item.path === $<HTMLSelectElement>('chart-select').value);
  if (!entry) return;
  setBusy(true);
  $('player').hidden = false;
  simulator.pause();
  try {
    const local = localCharts.get(entry.path);
    if (local) await simulator.loadLocal(local);
    else await simulator.load(entry);
    const info: ChartInfo = simulator.snapshot().info;
    simulator.updateInfo({ composer: info.composer || entry.composer, charter: info.charter || entry.charter });
    for (const input of document.querySelectorAll<HTMLInputElement>('[data-info]')) {
      input.value = simulator.snapshot().info[input.dataset.info as keyof ChartInfo] || '';
    }
    $('player').hidden = false;
    for (const id of ['btn-restart', 'btn-fullscreen', 'btn-export']) $<HTMLButtonElement>(id).disabled = false;
    simulator.configure(settings);
    status(localCharts.get(entry.path)?.data.warnings?.join('；') || '');
  } catch (error) { status(`载入失败：${error instanceof Error ? error.message : error}`); }
  finally { setBusy(false); $('loading-overlay').hidden = true; }
}
async function importSelection(files: File[]): Promise<void> {
  if (!files.length || busy || !ready || simulator.snapshot().exporting) return;
  setBusy(true); simulator.pause();
  try {
    const imported = await importFiles(files, status);
    for (const chart of imported) {
      localCharts.set(chart.id, chart);
      entries.unshift({ path: chart.id, name: chart.info.name,
        difficulty: chart.info.level.match(/^(EZ|HD|IN|AT|SP)/)?.[1] || 'LOCAL',
        level: chart.info.level, composer: chart.info.composer, charter: chart.info.charter });
    }
    $<HTMLSelectElement>('filter').value = 'LOCAL';
    $<HTMLInputElement>('search').value = '';
    renderLibrary();
    const warnings = [...new Set(imported.flatMap(chart => chart.data.warnings ?? []))];
    status(`已导入 ${imported.length} 张谱面，选择后点击加载。${warnings.length ? `兼容提示：${warnings.join('；')}` : ''}`);
  } catch (error) { status(error instanceof Error ? error.message : String(error)); }
  finally {
    setBusy(false); renderLibrary(); $<HTMLInputElement>('file-input').value = '';
  }
}

$('load-chart').onclick = () => { void loadSelected(); };
$<HTMLInputElement>('file-input').onchange = event => { void importSelection(Array.from((event.target as HTMLInputElement).files || [])); };
$('search').oninput = renderLibrary;
$('filter').onchange = renderLibrary;
for (const input of document.querySelectorAll<HTMLInputElement>('[data-info]')) {
  input.oninput = () => simulator.updateInfo({ [input.dataset.info!]: input.value });
}
$('autoplay').onchange = () => updateSettings({ autoplay: $<HTMLInputElement>('autoplay').checked });
$('speed').onchange = () => updateSettings({ speed: Number($<HTMLSelectElement>('speed').value) });
$('btn-restart').onclick = () => simulator.restart();
$('btn-fullscreen').onclick = () => {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void $('stage').requestFullscreen().catch(() => status('当前浏览器无法进入全屏'));
};
for (const input of document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-setting]')) {
  const commitSetting = () => {
    const key = input.dataset.setting as keyof Settings;
    const isCheckbox = input instanceof HTMLInputElement && input.type === 'checkbox';
    const isText = input instanceof HTMLInputElement && (input.type === 'text' || input.type === 'search');
    let value: number | boolean | string = isCheckbox ? input.checked : typeof settings[key] === 'string' ? input.value : Number(input.value);
    if (typeof value === 'number' && input instanceof HTMLInputElement) {
      if (!Number.isFinite(value)) return;
      value = Math.min(Number(input.max), Math.max(Number(input.min), value));
    }
    updateSettings({ [key]: value });
  };
  input.oninput = commitSetting;
  input.onchange = commitSetting;
}
let dragDepth = 0;
window.addEventListener('dragenter', event => {
  if (!event.dataTransfer?.types.includes('Files')) return;
  event.preventDefault(); dragDepth++; $('drop-zone').hidden = false;
});
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('drop-zone').hidden = true; } });
window.addEventListener('dragover', event => { if (event.dataTransfer?.types.includes('Files')) event.preventDefault(); });
window.addEventListener('drop', event => {
  event.preventDefault(); dragDepth = 0; $('drop-zone').hidden = true;
  void importSelection(Array.from(event.dataTransfer?.files || []));
});

let lastStatsUpdate = 0;
simulator.events.addEventListener('library', () => {
  $('player').hidden = true;
  $('catalog').scrollIntoView();
  $<HTMLSelectElement>('chart-select').focus();
});
simulator.events.addEventListener('error', event => status((event as CustomEvent<string>).detail));
simulator.events.addEventListener('frame', () => {
  if (performance.now() - lastStatsUpdate < 80) return;
  lastStatsUpdate = performance.now();
  const { exporting } = simulator.snapshot();
  $<HTMLFieldSetElement>('chart-info').disabled = busy || exporting;
});

async function boot(): Promise<void> {
  syncSettings();
  bindInput(simulator.canvas);
  await simulator.init(settings);
  const avatarSelect = document.querySelector<HTMLSelectElement>('[data-setting="playerAvatar"]')!;
  avatarSelect.replaceChildren(...simulator.avatars().map(entry => new Option(entry.name, entry.id)));
  if (!simulator.avatars().some(entry => entry.id === settings.playerAvatar)) settings.playerAvatar = 'OblivionPHIN';
  syncSettings();
  simulator.configure(settings);
  let library: { charts?: LibraryEntry[] } = {};
  try {
    const response = await fetch(asset('assets/library/index.json'));
    if (response.ok && response.headers.get('content-type')?.includes('json')) library = await response.json();
  } catch { /* The bundled sample remains available without a generated library. */ }
  entries = library.charts || [];
  entries.unshift({
    path: '/assets/library/AboutTheUniverse.SOTUIMIssionary/IN',
    asset: '/assets/library/AboutTheUniverse.SOTUIMIssionary',
    cover: '/assets/library/AboutTheUniverse.SOTUIMIssionary/IN/image.png',
    name: 'About The Universe', difficulty: 'IN', level: 'IN  Lv.14.0',
    composer: 'SOTUI & MIssionary', charter: '波流二象性'
  });
  entries.unshift({ path: '/assets/builtin/s6', name: 'True Home, True World（内置演示）', difficulty: 'IN', level: 'IN Lv.?' });
  ready = true; setBusy(false); renderLibrary();
}
void boot().catch(error => {
  $('loading-overlay').hidden = true;
  status(`启动失败：${error instanceof Error ? error.message : error}。请刷新重试。`);
});
