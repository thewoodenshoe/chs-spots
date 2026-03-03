export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export function parseHours(raw: string | null): Record<string, { open: string; close: string }> | null {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export function parsePromoList(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}
