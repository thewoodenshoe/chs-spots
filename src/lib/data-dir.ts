import path from 'path';

// Runtime-only path to avoid Turbopack statically tracing 67K+ files in data/
const DATA_SEGMENT = ['da', 'ta'].join('');

export function dataPath(...segments: string[]): string {
  return path.join(process.cwd(), DATA_SEGMENT, ...segments);
}

export function reportingPath(...segments: string[]): string {
  return dataPath('reporting', ...segments);
}

export function configPath(...segments: string[]): string {
  return dataPath('config', ...segments);
}
