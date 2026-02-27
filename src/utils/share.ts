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

function legacyCopy(text: string): boolean {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch { /* legacy not available */ }
  document.body.removeChild(textarea);
  return ok;
}

export async function shareSpot(title: string, spotId: number, spotType?: string, area?: string): Promise<'shared' | 'copied' | 'failed'> {
  const url = `${window.location.origin}/?spot=${spotId}`;
  const text = buildShareText(title, spotType || '', area || '');
  const shareData = { title, text, url };

  if (
    typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare(shareData)
  ) {
    try {
      await navigator.share(shareData);
      trackShare(spotId, title);
      return 'shared';
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return 'failed';
      }
    }
  }

  const copyText = `${text}\n${url}`;

  if (typeof navigator.clipboard?.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(copyText);
      trackShare(spotId, title);
      return 'copied';
    } catch { /* clipboard API failed, try legacy */ }
  }

  if (legacyCopy(copyText)) {
    trackShare(spotId, title);
    return 'copied';
  }

  return 'failed';
}

export { buildShareText, legacyCopy };
