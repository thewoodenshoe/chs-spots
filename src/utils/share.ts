import { trackShare } from '@/lib/analytics';

function buildShareText(title: string, spotType: string, area: string): string {
  const loc = area ? ` in ${area}` : '';
  switch (spotType) {
    case 'Coming Soon':
      return `✨ ${title} is opening soon${loc}`;
    case 'Recently Opened':
      return `🆕 ${title} just opened${loc}`;
    case 'Happy Hour':
      return `🍹 Happy hour at ${title}${loc}`;
    case 'Brunch':
      return `🥞 Brunch at ${title}${loc}`;
    case 'Live Music':
      return `🎸 Live music at ${title}${loc}`;
    case 'Fishing Spots':
      return `🎣 Check out ${title}${loc}`;
    case 'Landmarks & Attractions':
      return `🏛️ Check out ${title}${loc}`;
    default:
      return `Check out ${title}${loc}`;
  }
}

export async function shareSpot(title: string, spotId: number, spotType?: string, area?: string): Promise<'shared' | 'copied' | 'failed'> {
  const url = `${window.location.origin}/?spot=${spotId}`;
  const text = buildShareText(title, spotType || '', area || '');

  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, text, url });
      trackShare(spotId, title);
      return 'shared';
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return 'failed';
      }
    }
  }

  try {
    await navigator.clipboard.writeText(`${url}\n${text}`);
    trackShare(spotId, title);
    return 'copied';
  } catch {
    return 'failed';
  }
}
