import path from 'path';

function getDataRoot(): string {
  return process.env.DATA_DIR || path.resolve(process.cwd(), 'data');
}

export function dataPath(...segments: string[]): string {
  return path.join(getDataRoot(), ...segments);
}

export function reportingPath(...segments: string[]): string {
  return path.join(getDataRoot(), 'reporting', ...segments);
}

export function configPath(...segments: string[]): string {
  return path.join(getDataRoot(), 'config', ...segments);
}
