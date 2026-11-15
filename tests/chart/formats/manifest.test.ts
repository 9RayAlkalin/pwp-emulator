import { expect, it } from 'vitest';
import { isZepcManifest, parseZepcManifest } from '../../../src/chart/formats/manifest';
import { isZepcChart } from '../../../src/chart/formats/zepc';

it('recognises ZEPC manifests by structure, without a format field', () => {
  expect(isZepcManifest({ name: 'Song', difficulties: {} })).toBe(true);
  expect(isZepcManifest({ name: 'Song', difficulties: [], script: ['a.lua'] })).toBe(true);
  expect(isZepcManifest({ zepcVersion: 1, line: [] })).toBe(false);
  expect(isZepcManifest(null)).toBe(false);
  expect(isZepcChart({ name: 'Song', difficulties: {} })).toBe(false);
});

it('parses difficulty maps and shared defaults with singular script keys', () => {
  const manifest = parseZepcManifest({
    name: 'Song',
    composer: 'Composer',
    music: 'music.ogg',
    image: 'cover.png',
    script: ['base.lua'],
    textures: { note: 'note.png' },
    difficulties: {
      IN: { level: 'IN 14', chart: 'in.yml', script: ['in.lua'], textures: { extra: 'extra.png' } },
      AT: { name: 'Another', level: 'AT 16', chart: 'at.yml', music: 'at.ogg', image: 'at.png' },
    },
  });
  expect(manifest.name).toBe('Song');
  expect(manifest.difficulties.map(entry => entry.name)).toEqual(['IN', 'Another']);
  expect(manifest.difficulties[0]).toMatchObject({
    level: 'IN 14', chart: 'in.yml', music: 'music.ogg', image: 'cover.png', composer: 'Composer',
    scripts: ['base.lua', 'in.lua'], textures: { note: 'note.png', extra: 'extra.png' },
  });
  expect(manifest.difficulties[1]).toMatchObject({ music: 'at.ogg', image: 'at.png', scripts: ['base.lua'] });
  expect(() => parseZepcManifest({ name: 'Song' })).toThrow('difficulties');
  expect(() => parseZepcManifest({ name: '', difficulties: [{ chart: 'a' }] })).toThrow('name');
  expect(() => parseZepcManifest({ name: 'Song', difficulties: [{ level: 'IN' }] })).toThrow('chart');
});

it('does not read the old plural script key', () => {
  const manifest = parseZepcManifest({ name: 'Song', difficulties: [{ chart: 'a.yml' }], scripts: ['old.lua'] });
  expect(manifest.scripts).toEqual([]);
  expect(manifest.difficulties[0].scripts).toEqual([]);
});
