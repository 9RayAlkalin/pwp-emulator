export type MetadataFields = Record<string, string>;
const aliases: Record<string, string> = { song: 'music', picture: 'image', illustration: 'image', background: 'image',
  title: 'name', artist: 'composer' };
export function metadataKey(key: string): string {
  key = key.trim().replace(/^\uFEFF/, '').toLowerCase();
  return aliases[key] ?? key;
}
export function metadataFields(value: Record<string, unknown>): MetadataFields {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => typeof v === 'string' || typeof v === 'number')
    .map(([k, v]) => [metadataKey(k), String(v)]));
}

export function parseInfoText(text: string): MetadataFields[] {
  const rows: MetadataFields[] = []; let row: MetadataFields = {};
  const flush = () => { if (Object.keys(row).length) rows.push(row); row = {}; };
  for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    if (/^\s*#\s*$/.test(line)) { flush(); continue; }
    if (/^\s*(?:#|\/\/)/.test(line)) continue;
    const match = line.match(/^\s*([^:：]+?)\s*[:：]\s*(.*?)\s*$/);
    if (!match) continue;
    const key = metadataKey(match[1]);
    if (key === 'chart' && row.chart) flush();
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    row[key] = value;
  }
  flush(); return rows;
}

// ChartInfo only needs top-level scalar fields. Ignore arrays and nested
// metadata (tags etc.); reject unsupported syntax in fields used for import.
export function parseInfoYaml(text: string): MetadataFields {
  const result: MetadataFields = {}, lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const used = new Set(['name', 'level', 'music', 'image', 'chart', 'composer', 'charter', 'illustrator', 'format', 'offset', 'aspectratio']);
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^([\w-]+):(?:\s+(.*)|\s*)$/);
    if (!match) continue;
    const key = metadataKey(match[1]);
    if (!used.has(key)) continue;
    let value = match[2]?.trim() ?? '';
    if (/^[|>][-+]?\s*(?:#.*)?$/.test(value)) {
      const block: string[] = [], folded = value[0] === '>';
      while (i + 1 < lines.length && /^(?:\s+|$)/.test(lines[i + 1])) block.push(lines[++i].trim());
      value = block.join(folded ? ' ' : '\n').trimEnd();
    } else if (value.startsWith('"')) {
      const quoted = value.match(/^"(?:[^"\\]|\\.)*"/);
      if (!quoted || !/^\s*(?:#.*)?$/.test(value.slice(quoted[0].length))) throw new Error(`info.yml 的 ${key} 字符串无效`);
      try { value = JSON.parse(quoted[0]); } catch { throw new Error(`info.yml 的 ${key} 转义暂不支持`); }
    } else if (value.startsWith("'")) {
      const quoted = value.match(/^'((?:[^']|'')*)'\s*(?:#.*)?$/);
      if (!quoted) throw new Error(`info.yml 的 ${key} 字符串无效`);
      value = quoted[1].replaceAll("''", "'");
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
      if (!value || /^(?:null|~)$/i.test(value)) continue;
      if (/^[\[\]{}&*!]/.test(value)) throw new Error(`info.yml 的 ${key} 需要直接填写标量值`);
    }
    result[key] = value;
  }
  return result;
}
