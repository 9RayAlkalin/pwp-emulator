import { expect, it } from 'vitest';
import JSZip from 'jszip';
import { importFiles, parseChart } from './importer';

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
