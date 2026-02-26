export async function shareSpot(title: string, spotId: number): Promise<'shared' | 'copied' | 'failed'> {
  const url = `${window.location.origin}?spot=${spotId}`;

  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({
        title,
        text: `Check out ${title} on Charleston Finds`,
        url,
      });
      return 'shared';
    } catch {
      // User cancelled or API error — fall through to clipboard
    }
  }

  try {
    await navigator.clipboard.writeText(url);
    return 'copied';
  } catch {
    // Clipboard API blocked (e.g. non-HTTPS, permissions)
    return 'failed';
  }
}
