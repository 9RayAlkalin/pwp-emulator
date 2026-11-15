import { expect, it } from 'vitest';
import JSZip from 'jszip';
import { importFiles } from '../../../src/chart/import/importer';

const yamlChart = `zepcVersion: 1
timing: beats
bpm: 120
script: [local.lua]
line:
  - note:
      - type: 1
        beat: 1
        x: 0.5
`;

const phigrosChart = () => ({
  formatVersion: 3, offset: 0, judgeLineList: [{ bpm: 120,
    notesAbove: [{ type: 1, time: 32, holdTime: 0, positionX: 0, speed: 1, hitSound: 'hit.ogg' }], notesBelow: [],
    speedEvents: [{ startTime: 0, endTime: 100, value: 1 }],
    judgeLineMoveEvents: [{ startTime: 0, endTime: 100, start: 0.5, end: 0.5, start2: 0.5, end2: 0.5 }],
    judgeLineRotateEvents: [], judgeLineDisappearEvents: [],
  }] });

async function archive(entries: Record<string, string>, name = 'song.zepc'): Promise<File> {
  const zip = new JSZip();
  for (const [path, data] of Object.entries(entries)) zip.file(path, data);
  return new File([new Uint8Array(await zip.generateAsync({ type: 'uint8array' }))], name);
}

it('imports every difficulty of a ZEPC pack with shared and per-difficulty assets', async () => {
  const file = await archive({
    'pack/meta.yaml': `name: Pack Song
composer: Artist
charter: Mapper
music: music.ogg
image: image.png
script: [scripts/base.lua]
difficulties:
  IN:
    level: IN 14
    chart: charts/in.yaml
  EX:
    level: EX 15
    chart: charts/ex.json
    music: ex.ogg
    image: ex.png
    script: [charts/extra.lua]
    hitsounds:
      hit: ex-hit.ogg
`,
    'pack/charts/in.yaml': yamlChart,
    'pack/charts/local.lua': 'pwp.log("local")',
    'pack/charts/ex.json': JSON.stringify(phigrosChart()),
    'pack/charts/extra.lua': 'pwp.log("extra")',
    'pack/scripts/base.lua': 'pwp.log("base")',
    'pack/music.ogg': 'shared', 'pack/ex.ogg': 'ex',
    'pack/image.png': 'cover', 'pack/ex.png': 'excover',
    'pack/ex-hit.ogg': 'hit',
  });
  const charts = await importFiles([file], () => {});
  expect(charts).toHaveLength(2);
  expect(charts.map(chart => chart.info.name)).toEqual(['Pack Song', 'Pack Song']);
  expect(charts.map(chart => chart.info.level)).toEqual(['IN 14', 'EX 15']);
  expect(charts.map(chart => chart.info.composer)).toEqual(['Artist', 'Artist']);
  expect(charts.map(chart => chart.data.sourceFormat)).toEqual(['zepc', 'phigros']);
  expect(charts.map(chart => chart.pack)).toEqual([
    { name: 'Pack Song', difficulty: 'IN 14' },
    { name: 'Pack Song', difficulty: 'EX 15' },
  ]);

  expect(await charts[0].music.text()).toBe('shared');
  expect(await charts[1].music.text()).toBe('ex');
  expect(await charts[0].image!.text()).toBe('cover');
  expect(await charts[1].image!.text()).toBe('excover');
  expect(charts[0].scripts!.map(script => script.name)).toEqual([
    'pack/scripts/base.lua', 'pack/charts/local.lua',
  ]);
  expect(charts[1].scripts!.map(script => script.name)).toEqual([
    'pack/scripts/base.lua', 'pack/charts/extra.lua',
  ]);
  expect(charts[0].data.judgeLineList[0].notesAbove[0].time).toBeCloseTo(0.5);
  expect(Object.keys(charts[1].hitsounds ?? {})).toEqual(['hit']);
});

it('resolves manifest scripts by manifest-relative path when basenames repeat', async () => {
  const file = await archive({
    'pack/meta.yaml': `name: Scripts
music: music.ogg
script: [scripts/base.lua]
difficulties:
  - chart: charts/chart.yaml
`,
    'pack/charts/chart.yaml': yamlChart,
    'pack/charts/local.lua': '',
    'pack/scripts/base.lua': 'pwp.log("shared")',
    'pack/other/base.lua': 'pwp.log("decoy")',
    'pack/music.ogg': 'song',
  });
  const charts = await importFiles([file], () => {});
  expect(charts[0].scripts!.map(script => [script.name, script.source])).toEqual([
    ['pack/scripts/base.lua', 'pwp.log("shared")'],
    ['pack/charts/local.lua', ''],
  ]);
});

it('auto-selects a unique chart-named audio and cover inside a pack', async () => {
  const file = await archive({
    'meta.yaml': `name: Auto
difficulties:
  - name: HD
    level: HD 10
    chart: charts/song.yaml
`,
    'charts/song.yaml': yamlChart,
    'charts/local.lua': '',
    'charts/song.ogg': 'song audio',
    'charts/song.png': 'song cover',
  });
  const charts = await importFiles([file], () => {});
  expect(charts).toHaveLength(1);
  expect(await charts[0].music.text()).toBe('song audio');
  expect(await charts[0].image!.text()).toBe('song cover');
});

it('reports missing pack resources and ambiguity instead of importing partial charts', async () => {
  const missing = await archive({
    'meta.yaml': `name: Broken
difficulties:
  - chart: chart.yaml
`,
    'chart.yaml': yamlChart,
  });
  await expect(importFiles([missing], () => {})).rejects.toThrow('音频');

  const ambiguous = await archive({
    'meta.yaml': `name: Ambiguous
difficulties:
  - chart: chart.yaml
    music: missing.ogg
`,
    'chart.yaml': yamlChart, 'a.ogg': 'a', 'b.ogg': 'b',
  });
  await expect(importFiles([ambiguous], () => {})).rejects.toThrow('missing.ogg');
});

it('does not import pack-owned chart files as standalone charts', async () => {
  const file = await archive({
    'meta.yaml': `name: Owned
music: music.ogg
difficulties:
  - chart: chart.yaml
`,
    'chart.yaml': yamlChart, 'local.lua': '', 'music.ogg': 'song',
  });
  const charts = await importFiles([file], () => {});
  expect(charts).toHaveLength(1);
  expect(charts[0].data.sourceFormat).toBe('zepc');
  expect(charts[0].data.judgeLineList).toHaveLength(1);
});
