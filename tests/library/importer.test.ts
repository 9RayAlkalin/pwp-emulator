import { expect, it } from 'vitest';
import JSZip from 'jszip';
import { importFiles, parseChart } from '../../src/library/importer';

const chart = () => ({ formatVersion: 3, offset: 0, judgeLineList: [{ bpm: 120,
  notesAbove: [{ type: 1, time: 32, holdTime: 0, positionX: 0, speed: 1 }], notesBelow: [],
  speedEvents: [{ startTime: 0, endTime: 100, value: 1 }],
  judgeLineMoveEvents: [{ startTime: 0, endTime: 100, start: 0.5, end: 0.5, start2: 0.5, end2: 0.5 }],
  judgeLineRotateEvents: [], judgeLineDisappearEvents: [],
}] });
it('validates input and converts version 1 packed coordinates without mutating the source', () => {
  const raw = chart(); raw.formatVersion = 1; raw.judgeLineList[0].judgeLineMoveEvents[0].start = 440260;
  const result = parseChart(raw);
  expect(result.judgeLineList[0].judgeLineMoveEvents[0].start).toBe(0.5);
  expect(result.judgeLineList[0].judgeLineMoveEvents[0].start2).toBe(0.5);
  expect(raw.judgeLineList[0].judgeLineMoveEvents[0].start).toBe(440260);
  raw.judgeLineList[0].bpm = 0;
  expect(() => parseChart(raw)).toThrow('BPM');
});
it('imports loose files with one shared song and optional cover', async () => {
  const files = [new File([JSON.stringify(chart())], 'chart.json'), new File(['audio'], 'music.ogg')];
  const result = await importFiles(files, () => {});
  expect(result).toHaveLength(1); expect(result[0].info.name).toBe('chart'); expect(result[0].music.size).toBe(5);
});
it('reads zipped charts and quoted CSV metadata with explicit multiple-song associations', async () => {
  const zip = new JSZip();
  zip.file('one.json', JSON.stringify(chart())); zip.file('two.json', JSON.stringify(chart()));
  zip.file('one.ogg', 'one'); zip.file('two.ogg', 'two');
  zip.file('info.csv', 'Chart,Music,Name,Level\none.json,one.ogg,"Song, One",IN 12\ntwo.json,two.ogg,Song Two,HD 8');
  const data = await zip.generateAsync({ type: 'uint8array' });
  const result = await importFiles([new File([new Uint8Array(data)], 'charts.zip')], () => {});
  expect(result.map(item => item.info.name)).toEqual(['Song, One', 'Song Two']);
});
it('rejects ambiguous audio instead of silently picking the wrong track', async () => {
  const files = [new File([JSON.stringify(chart())], 'chart.json'), new File(['1'], 'one.ogg'), new File(['2'], 'two.ogg')];
  await expect(importFiles(files, () => {})).rejects.toThrow('无法匹配音乐');
});

const pec = '175 bp 0 120 cp 0 0 1024 700 cv 0 0 7 n1 0 1 0 1 0';
async function archive(entries: Record<string, string>, name = 'chart.pez'): Promise<File> {
  const zip = new JSZip();
  for (const [path, data] of Object.entries(entries)) zip.file(path, data);
  return new File([new Uint8Array(await zip.generateAsync({ type: 'uint8array' }))], name);
}

it('imports info.txt key-value metadata, colons in titles, quoted paths and Windows separators', async () => {
  const file = await archive({
    'pack/info.txt': '\uFEFF#\r\nName: Song: One\r\nSong: "audio\\one.ogg"\r\nPicture: cover.png\r\nChart: charts\\score.pec\r\nLevel: IN 14\r\nComposer: Artist\r\nCharter: Mapper\r\nIllustrator: Painter',
    'pack/charts/score.pec': pec, 'pack/audio/one.ogg': 'first', 'pack/audio/two.ogg': 'second', 'pack/cover.png': 'cover',
  });
  const result = await importFiles([file], () => {});
  expect(result).toHaveLength(1);
  expect(result[0].info).toEqual({ name: 'Song: One', level: 'IN 14', composer: 'Artist', charter: 'Mapper', illustrator: 'Painter' });
  expect(await result[0].music.text()).toBe('first');
  expect(await result[0].image!.text()).toBe('cover');
  expect(result[0].data.sourceFormat).toBe('pec');
});

it('supports several info.txt records and keeps their explicit chart/music associations', async () => {
  const result = await importFiles([await archive({
    'info.txt': '#\nName: One\nSong: one.ogg\nChart: one.pec\n#\nName: Two\nSong: two.ogg\nChart: two.pec',
    'one.pec': pec, 'two.pec': pec, 'one.ogg': 'one', 'two.ogg': 'two',
  })], () => {});
  expect(result.map(c => c.info.name)).toEqual(['One', 'Two']);
  expect(await Promise.all(result.map(c => c.music.text()))).toEqual(['one', 'two']);
});

it('reads info.yml scalars and format hints for arbitrary chart extensions with authoritative metadata', async () => {
  const result = await importFiles([await archive({
    'info.yml': "name: 'Yaml: Song #1' # comment\nchart: score.data\nformat: Pec\nmusic: music.ogg\nillustration: cover.png\ncharter: \"Mapper\\nTwo\"\noffset: 0.25\nlevel: IN 12\ntags: [a, b]",
    'info.txt': 'Name: Text Song\nChart: score.data\nComposer: Text Artist',
    'score.data': pec, 'music.ogg': 'song', 'cover.png': 'cover',
  })], () => {});
  expect(result[0].info).toMatchObject({ name: 'Yaml: Song #1', charter: 'Mapper\nTwo', composer: 'Text Artist', level: 'IN 12' });
  expect(result[0].data.offset).toBe(.25);
});

it('uses RPE META as a fallback and detects JSON content even with a .pec extension', async () => {
  const rpe = { META: { name: 'From RPE', level: 'AT 16', song: 'two.ogg', background: 'two.png', offset: 100 },
    BPMList: [{ startTime: [0, 0, 1], bpm: 120 }], judgeLineList: [{ eventLayers: [], notes: [] }] };
  const result = await importFiles([await archive({ 'score.pec': JSON.stringify(rpe),
    'one.ogg': '1', 'two.ogg': '22', 'one.png': '1', 'two.png': '22' })], () => {});
  expect(result[0].info.name).toBe('From RPE'); expect(result[0].music.size).toBe(2); expect(result[0].image!.size).toBe(2);
  expect(result[0].data.offset).toBe(-.1);
});

it('keeps separate archives with duplicate filenames isolated', async () => {
  const result = await importFiles([
    await archive({ 'chart.pec': pec, 'music.ogg': 'one', 'info.txt': 'Name: First\nSong: music.ogg' }, 'one.pez'),
    await archive({ 'chart.pec': pec, 'music.ogg': 'two', 'info.txt': 'Name: Second\nSong: music.ogg' }, 'two.pez'),
  ], () => {});
  expect(result.map(c => c.info.name)).toEqual(['First', 'Second']);
  expect(await Promise.all(result.map(c => c.music.text()))).toEqual(['one', 'two']);
});

it('rejects missing explicit resources and unsupported format hints instead of falling back', async () => {
  await expect(importFiles([await archive({ 'chart.pec': pec, 'music.ogg': 'music',
    'info.txt': 'Chart: chart.pec\nSong: missing.ogg' })], () => {})).rejects.toThrow('missing.ogg');
  await expect(importFiles([await archive({ 'chart.pec': pec, 'music.ogg': 'music',
    'info.yml': 'chart: chart.pec\nformat: Pbc' })], () => {})).rejects.toThrow('Pbc');
});

it('detects renamed loose charts by content without metadata or a recognized extension', async () => {
  const result = await importFiles([new File([pec], 'renamed.data'), new File(['song'], 'music.ogg')], () => {});
  expect(result[0].data.sourceFormat).toBe('pec');
});

it('preserves unambiguous CSV basenames and conventional covers alongside other package images', async () => {
  const result = await importFiles([await archive({
    'info.csv': 'Chart,Music,Name\nscore.pec,music.ogg,Basename',
    'folder/score.pec': pec, 'folder/music.ogg': 'song', 'folder/image.png': 'cover', 'folder/line.png': 'texture',
  })], () => {});
  expect(result[0].info.name).toBe('Basename');
  expect(await result[0].image!.text()).toBe('cover');
});

it('leaves reused JSON metadata and postfx intact', async () => {
  const result = await importFiles([await archive({
    'chart.json': JSON.stringify(chart()), 'music.ogg': 'song',
    'info.json': JSON.stringify({ name: 'JSON Info', music: 'music.ogg', illustrator: 'Painter' }),
    'postfx.json': JSON.stringify({ curves: { brightness: [[0, 1]] } }),
  })], () => {});
  expect(result[0].info).toMatchObject({ name: 'JSON Info', illustrator: 'Painter' });
  expect(result[0].postfx).toEqual({ curves: { brightness: [[0, 1]] } });
});

it('preserves referenced line images and GIFs without mistaking them for chart artwork', async () => {
  const raw = { META: {}, BPMList: [{ startTime: [0, 0, 1], bpm: 120 }],
    judgeLineList: [{ Texture: 'Textures\\Panel.PNG' }, { Texture: 'textures/anim.gif' }] };
  const result = await importFiles([await archive({ 'pack/chart.json': JSON.stringify(raw), 'pack/song.ogg': 'song',
    'pack/textures/panel.png': 'panel', 'pack/textures/anim.GIF': 'animation' })], () => {});
  expect(Object.keys(result[0].textures!)).toEqual(['Textures\\Panel.PNG', 'textures/anim.gif']);
  expect(await result[0].textures!['textures/anim.gif'].text()).toBe('animation');
  expect(result[0].image).toBeUndefined();
  expect(result[0].data.warnings).toEqual([]);
});

it('reports a missing custom texture instead of drawing a replacement judgement line', async () => {
  const raw = { META: {}, BPMList: [{ startTime: [0, 0, 1], bpm: 120 }], judgeLineList: [{ Texture: 'missing.png' }] };
  await expect(importFiles([await archive({ 'chart.json': JSON.stringify(raw), 'music.ogg': 'song' })], () => {})).rejects.toThrow('missing.png');
});

it('preserves the chart aspect ratio from info.yml and rejects invalid ratios', async () => {
  const files = { 'chart.pec': pec, 'music.ogg': 'music', 'info.yml': 'chart: chart.pec\naspectRatio: 1.3333333333333333' };
  const result = await importFiles([await archive(files)], () => {});
  expect(result[0].data.aspectRatio).toBeCloseTo(4 / 3);
  await expect(importFiles([await archive({ ...files, 'info.yml': 'chart: chart.pec\naspectRatio: 0' })], () => {})).rejects.toThrow('aspectRatio');
});
