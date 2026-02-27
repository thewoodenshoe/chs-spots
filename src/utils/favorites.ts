const STORAGE_KEY = 'chs-finds-favorites';

function getIds(): Set<number> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? new Set(JSON.parse(raw) as number[]) : new Set();
  } catch {
    return new Set();
  }
}

function persist(ids: Set<number>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
}

export function isFavorite(spotId: number): boolean {
  return getIds().has(spotId);
}

export function toggleFavorite(spotId: number, spotName?: string): boolean {
  const ids = getIds();
  const nowFav = !ids.has(spotId);
  if (nowFav) ids.add(spotId);
  else ids.delete(spotId);
  persist(ids);
  try {
    import('@/lib/analytics').then(({ trackFavorite }) => {
      trackFavorite(spotId, spotName || String(spotId), nowFav ? 'add' : 'remove');
    });
  } catch { /* analytics not critical */ }
  return nowFav;
}

export function getFavoriteIds(): number[] {
  return [...getIds()];
}
