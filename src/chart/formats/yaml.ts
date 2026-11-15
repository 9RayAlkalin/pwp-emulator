import { parse as parseYaml } from 'yaml';
import { record } from './compiler';

export function source(value: unknown, label: string): Record<string, any> {
  if (typeof value === 'string') {
    try { value = parseYaml(value.replace(/^\uFEFF/, '')); }
    catch (error) { throw new Error(`${label} YAML 解析失败：${error instanceof Error ? error.message : error}`); }
  }
  return record(value, label);
}

export function text(value: unknown, label: string, fallback = ''): string {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string') throw new Error(`${label} 必须为字符串`);
  return value;
}

export function optionalText(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return text(value, label);
}
