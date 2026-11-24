import type { ClipItem } from '../types';
import { sanitizeFilename } from './youtube';

export function getClipFilename(clip: ClipItem): string {
  return `${sanitizeFilename(clip.title)}.mp4`;
}

/**
 * Builds a validated, direct download URL for a clip MP4.
 * For ClipGenie API clip endpoints, appends ?download=1&name=<slug> so the server
 * sends Content-Disposition: attachment and Chrome downloads synchronously inside iframes.
 */
export function buildClipDownloadUrl(clip: ClipItem): string | null {
  const url = clip.videoUrl;
  if (!url || (!url.startsWith('/') && !url.startsWith('https://') && !url.startsWith('http://'))) {
    return null;
  }

  if (url.includes('/api/jobs/')) {
    const slug = sanitizeFilename(clip.title);
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}download=1&name=${encodeURIComponent(slug)}`;
  }

  return url;
}

/**
 * Triggers a synchronous browser download inside the active user click gesture
 * (no awaited fetch before clicking the anchor, which prevents iframe user-activation loss).
 */
export function triggerSynchronousDownload(clip: ClipItem): boolean {
  const downloadUrl = buildClipDownloadUrl(clip);
  if (!downloadUrl) {
    return false;
  }

  const filename = getClipFilename(clip);
  const anchor = document.createElement('a');
  anchor.href = downloadUrl;
  anchor.download = filename;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  return true;
}

export function downloadClipFile(clip: ClipItem): void {
  const ok = triggerSynchronousDownload(clip);
  if (!ok) {
    throw new Error('Unsupported clip download URL.');
  }
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to legacy textarea copy
    }
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', 'true');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    textarea.remove();
    return ok;
  } catch {
    return false;
  }
}
