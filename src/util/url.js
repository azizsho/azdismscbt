/** YouTube URL validation and query cleanup. */

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'youtu.be',
  'youtube-nocookie.com',
]);

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const PLAYLIST_ID_RE = /^[A-Za-z0-9_-]{10,100}$/;

/**
 * @param {string} input
 * @returns {URL | null}
 */
export function parseUrl(input) {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url;
  } catch {
    return null;
  }
}

/** @param {string} input */
export function isYouTubeUrl(input) {
  const url = parseUrl(input);
  if (!url) return false;
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (YOUTUBE_HOSTS.has(host)) return true;
  // music.youtube.com and m.youtube.com are common variants.
  return host === 'music.youtube.com' || host.endsWith('.youtube.com');
}

/**
 * Allow users to paste `youtu.be/...` or `youtube.com/watch?...` without the
 * scheme. Everything else is returned unchanged.
 *
 * @param {string} input
 */
export function normalizeYouTubeInput(input) {
  const trimmed = String(input ?? '').trim();
  if (/^(?:www\.|m\.|music\.)?(?:youtube\.com|youtu\.be)\//i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return trimmed;
}

/** @param {string} input */
export function extractVideoId(input) {
  const url = parseUrl(input);
  if (!url) return null;

  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (host === 'youtu.be') {
    const id = url.pathname.split('/').filter(Boolean)[0];
    return id && VIDEO_ID_RE.test(id) ? id : null;
  }

  if (host !== 'youtube.com' && !host.endsWith('.youtube.com') && host !== 'youtube-nocookie.com') {
    return null;
  }

  const v = url.searchParams.get('v');
  if (v && VIDEO_ID_RE.test(v)) return v;

  const match = url.pathname.match(/\/(?:shorts|embed|live|v)\/([A-Za-z0-9_-]{11})(?:[/?]|$)/);
  return match?.[1] ?? null;
}

/** @param {string} input */
export function extractPlaylistId(input) {
  const url = parseUrl(input);
  if (!url) return null;
  const list = url.searchParams.get('list');
  return list && PLAYLIST_ID_RE.test(list) ? list : null;
}

/** @param {string} input */
export function isPlaylistUrl(input) {
  const url = parseUrl(input);
  if (!url || !isYouTubeUrl(input)) return false;
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (host === 'youtu.be') return false;
  return url.pathname === '/playlist' || Boolean(extractPlaylistId(input));
}

/**
 * Turn a YouTube URL into a canonical watch/playlist URL, stripping tracking
 * parameters and playlist context for single-video playback.
 *
 * @param {string} input
 * @param {{ keepPlaylist?: boolean }} [options]
 */
export function canonicalizeYouTubeUrl(input, options = {}) {
  if (!isYouTubeUrl(input)) {
    throw new Error('That is not a YouTube URL.');
  }

  const { keepPlaylist = false } = options;
  const playlistId = extractPlaylistId(input);

  if (keepPlaylist && playlistId) {
    const videoId = extractVideoId(input);
    if (videoId && !isPlaylistUrl(input)) {
      return `https://www.youtube.com/watch?v=${videoId}&list=${playlistId}`;
    }
    return `https://www.youtube.com/playlist?list=${playlistId}`;
  }

  const videoId = extractVideoId(input);
  if (videoId) return `https://www.youtube.com/watch?v=${videoId}`;

  if (playlistId) return `https://www.youtube.com/playlist?list=${playlistId}`;

  throw new Error('Could not find a video or playlist ID in that URL.');
}

/** Remove control characters and collapse whitespace in a search query. */
export function sanitizeQuery(input, maxLength = 200) {
  if (typeof input !== 'string') return '';
  return input
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

/**
 * Would passing this string to yt-dlp be treated as a URL?
 * @param {string} input
 */
export function looksLikeUrl(input) {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(input.trim());
}
