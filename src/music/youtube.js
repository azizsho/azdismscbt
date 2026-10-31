import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { UserError, isAbortError } from '../util/errors.js';
import {
  canonicalizeYouTubeUrl,
  extractPlaylistId,
  extractVideoId,
  isYouTubeUrl,
  sanitizeQuery,
} from '../util/url.js';

const MAX_STDOUT_BYTES = 32 * 1024 * 1024;
const MAX_STDERR_BYTES = 256 * 1024;
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

/** Simple FIFO semaphore used to cap concurrent yt-dlp processes. */
class Semaphore {
  constructor(limit) {
    this.limit = Math.max(1, limit);
    this.active = 0;
    /** @type {Array<() => void>} */
    this.waiting = [];
  }

  async acquire() {
    if (this.active < this.limit) {
      this.active++;
      return;
    }
    /** @type {Promise<void>} */
    const slot = new Promise((resolve) => this.waiting.push(() => resolve()));
    await slot;
    this.active++;
  }

  release() {
    this.active = Math.max(0, this.active - 1);
    const next = this.waiting.shift();
    if (next) next();
  }
}

/** @typedef {{
 *   id: string,
 *   title: string,
 *   url: string,
 *   durationSec: number | null,
 *   thumbnail: string | null,
 *   channel: string | null,
 *   isLive: boolean,
 *   source: 'youtube',
 *   requester?: { id: string, username: string, displayName: string },
 *   codec?: string | null,
 *   seekOffsetMs?: number,
 * }} Track */

function pickThumbnail(entry) {
  if (typeof entry.thumbnail === 'string' && entry.thumbnail) return entry.thumbnail;
  if (!Array.isArray(entry.thumbnails)) return null;

  // Prefer a reasonably sized image; Discord will scale it in the embed.
  const sorted = [...entry.thumbnails]
    .filter((thumb) => thumb && typeof thumb.url === 'string')
    .sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
  const preferred = sorted.find((thumb) => (thumb.width ?? 0) >= 300 && (thumb.width ?? 0) <= 1280);
  return preferred?.url ?? sorted[0]?.url ?? null;
}

function cleanErrorMessage(stderr) {
  return stderr
    .replace(/\u001b\[[0-9;]*m/g, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-12)
    .join('\n');
}

function mapYtDlpError(stderr, fallback) {
  const text = cleanErrorMessage(stderr);
  const lower = text.toLowerCase();

  if (/sign in to confirm|not a bot|use --cookies|cookies-from-browser|captcha|unusual traffic/.test(lower)) {
    return new UserError(
      'YouTube is asking this computer to sign in. Add a `cookies.txt` file (see README) or try again later.',
      { code: 'YOUTUBE_AUTH' },
    );
  }
  if (/failed to extract any player response|nsig extraction failed|unable to extract|some formats may be missing/.test(lower)) {
    return new UserError('YouTube changed something and yt-dlp could not extract this video. Run "npm run update-tools" and retry.', {
      code: 'YTDLP_EXTRACT',
    });
  }
  if (/http error 403|forbidden|unable to download video data/.test(lower)) {
    return new UserError('YouTube refused the download (403). Update yt-dlp or configure YouTube cookies.', {
      code: 'YOUTUBE_403',
    });
  }
  if (/private video|video unavailable|this video is unavailable|has been removed|not available in your country/.test(lower)) {
    return new UserError('That video is unavailable, private, or region-blocked.', { code: 'VIDEO_UNAVAILABLE' });
  }
  if (/age-restricted|confirm your age|inappropriate for some users/.test(lower)) {
    return new UserError('That video is age-restricted. Configure YouTube cookies to play it.', {
      code: 'AGE_RESTRICTED',
    });
  }
  if (/http error 429|too many requests/.test(lower)) {
    return new UserError('YouTube is rate-limiting requests. Wait a minute and try again.', {
      code: 'YOUTUBE_RATE_LIMIT',
    });
  }
  if (/unsupported url/.test(lower)) {
    return new UserError('That URL is not supported. Use a YouTube video or playlist link.', {
      code: 'UNSUPPORTED_URL',
    });
  }
  if (/playlist does not exist|the playlist does not exist|playlist type is unviewable/.test(lower)) {
    return new UserError('That playlist is unavailable, private, or cannot be opened by yt-dlp.', {
      code: 'PLAYLIST_UNAVAILABLE',
    });
  }
  if (/requested format is not available/.test(lower)) {
    return new UserError('No playable audio format was available for that video.', {
      code: 'NO_AUDIO_FORMAT',
    });
  }
  if (/ffmpeg/.test(lower) && /not found|not installed/.test(lower)) {
    return new UserError('ffmpeg is missing on the host. Run "npm run doctor".', { code: 'FFMPEG_MISSING' });
  }

  return new UserError(fallback, { code: 'YTDLP_ERROR', cause: new Error(text || 'yt-dlp failed') });
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export class YouTube {
  /**
   * @param {ReturnType<typeof import('../config.js').loadConfig>} config
   * @param {ReturnType<typeof import('../logger.js').createLogger>} logger
   */
  constructor(config, logger) {
    this.config = config;
    this.logger = logger.child('youtube');
    this.semaphore = new Semaphore(config.ytdlpConcurrency ?? 4);
    this.versionCheckedAt = 0;
    this.versionInfo = null;
  }

  get #baseArgs() {
    const args = [
      '--ignore-config',
      '--no-update',
      '--no-warnings',
      '--no-progress',
      '--socket-timeout',
      '20',
      '--retries',
      '3',
      '--extractor-retries',
      '3',
      '--js-runtimes',
      `node:${this.config.nodePath}`,
      '--ffmpeg-location',
      this.config.ffmpegPath,
      '--cache-dir',
      this.config.ytdlpCacheDir,
    ];

    if (this.config.cookiesFile) {
      args.push('--cookies', this.config.cookiesFile);
    }
    return args;
  }

  /**
   * Search YouTube without downloading anything.
   * @param {string} query
   * @param {number} [limit]
   * @returns {Promise<Track[]>}
   */
  async search(query, limit = 8) {
    const clean = sanitizeQuery(query, 200);
    if (!clean) throw new UserError('Type a song name or a YouTube link.');

    const count = Math.min(10, Math.max(1, limit));
    const json = await this.#json([
      ...this.#baseArgs,
      '--flat-playlist',
      '--dump-single-json',
      '--',
      `ytsearch${count}:${clean}`,
    ]);

    const entries = Array.isArray(json.entries) ? json.entries : [];
    return entries
      .map((entry) => this.#entryToTrack(entry))
      .filter((track) => track !== null && !track.isLive);
  }

  /**
   * Resolve a YouTube video or playlist URL.
   *
   * @param {string} input
   * @param {{ playlist?: boolean }} [options]
   * @returns {Promise<
   *   | { kind: 'track', track: Track }
   *   | { kind: 'playlist', title: string, tracks: Track[], skipped: number, total: number, truncated: boolean }
   * >}
   */
  async resolveUrl(input, options = {}) {
    if (!isYouTubeUrl(input)) {
      throw new UserError('That is not a YouTube link.');
    }

    const videoId = extractVideoId(input);
    const playlistId = extractPlaylistId(input);
    const mustBePlaylist = !videoId && Boolean(playlistId);
    const wantsPlaylist = Boolean(options.playlist) || mustBePlaylist;

    if (wantsPlaylist && playlistId) {
      return this.#resolvePlaylist(input);
    }
    if (!videoId) {
      throw new UserError('Could not find a video ID in that URL.');
    }

    const canonical = canonicalizeYouTubeUrl(input, { keepPlaylist: false });
    const json = await this.#json([
      ...this.#baseArgs,
      '--no-playlist',
      '--dump-single-json',
      '--',
      canonical,
    ]);
    const track = this.#entryToTrack(json);
    if (!track) throw new UserError('Could not read that video.');
    return { kind: 'track', track };
  }

  /**
   * @param {string} input
   * @returns {Promise<{ kind: 'playlist', title: string, tracks: Track[], skipped: number, total: number, truncated: boolean }>}
   */
  async #resolvePlaylist(input) {
    const playlistId = extractPlaylistId(input);
    if (!playlistId) throw new UserError('Could not find a playlist ID in that URL.');

    const limit = this.config.maxPlaylistItems;
    const fetchLimit = Math.min(200, limit + 25);
    const json = await this.#json([
      ...this.#baseArgs,
      '--flat-playlist',
      '--dump-single-json',
      '--playlist-end',
      String(fetchLimit),
      '--',
      `https://www.youtube.com/playlist?list=${playlistId}`,
    ]);

    const entries = Array.isArray(json.entries) ? json.entries : [];
    const tracks = [];
    let skipped = 0;

    for (const entry of entries) {
      const track = this.#entryToTrack(entry);
      if (!track || track.isLive || (track.durationSec !== null && track.durationSec > this.config.maxTrackSeconds)) {
        skipped++;
        continue;
      }
      tracks.push(track);
      if (tracks.length >= limit) break;
    }

    if (tracks.length === 0) {
      throw new UserError('That playlist has no playable tracks (or all of them are too long/live).', {
        code: 'EMPTY_PLAYLIST',
      });
    }

    const total = numberOrNull(json.playlist_count) ?? entries.length;
    return {
      kind: 'playlist',
      title: typeof json.title === 'string' && json.title ? json.title : 'YouTube playlist',
      tracks,
      skipped: Math.max(0, skipped),
      total,
      truncated: total > tracks.length,
    };
  }

  /**
   * Download the best audio-only stream to the cache directory.
   * Returns the final file path.
   *
   * @param {Track} track
   * @param {{ signal?: AbortSignal }} [options]
   * @returns {Promise<string>}
   */
  async download(track, options = {}) {
    if (!VIDEO_ID_RE.test(track.id)) {
      throw new UserError('Invalid YouTube video ID.', { code: 'INVALID_VIDEO_ID' });
    }

    const outputTemplate = path.join(this.config.cacheDir, `${track.id}.%(ext)s`);
    const args = [
      ...this.#baseArgs,
      '--quiet',
      '--no-playlist',
      '-f',
      'bestaudio[acodec=opus]/bestaudio/best',
      '--output',
      outputTemplate,
      '--print',
      'after_move:filepath',
      '--',
      track.url,
    ];

    const stdout = await this.#run(args, {
      signal: options.signal,
      timeoutMs: 10 * 60 * 1000,
      label: 'download',
    });

    const lines = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const printed = [...lines].reverse().find((line) => path.isAbsolute(line) && !line.startsWith('['));

    let filePath = printed ?? '';
    if (!filePath) {
      // Fallback for unusual yt-dlp output: find the file by video ID.
      const files = await fs.readdir(this.config.cacheDir).catch(() => []);
      const candidate = files.find((file) => file.startsWith(`${track.id}.`) && !file.endsWith('.part'));
      if (candidate) filePath = path.join(this.config.cacheDir, candidate);
    }

    if (!filePath) {
      throw new UserError('The download finished but the audio file could not be found.', {
        code: 'DOWNLOAD_MISSING',
      });
    }

    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat || !stat.isFile() || stat.size < 1024) {
      throw new UserError('The downloaded audio file is empty. Try another video.', { code: 'DOWNLOAD_EMPTY' });
    }

    this.logger.debug(`Downloaded ${track.id} (${(stat.size / 1024 / 1024).toFixed(1)} MiB)`);
    return filePath;
  }

  /**
   * @param {any} entry
   * @returns {Track | null}
   */
  #entryToTrack(entry) {
    if (!entry || typeof entry !== 'object') return null;
    const id = typeof entry.id === 'string' ? entry.id : null;
    if (!id || !VIDEO_ID_RE.test(id)) return null;

    const isLive =
      entry.is_live === true ||
      entry.live_status === 'is_live' ||
      entry.live_status === 'is_upcoming';

    const duration = numberOrNull(entry.duration);
    const title = typeof entry.title === 'string' && entry.title.trim() ? entry.title.trim() : 'Unknown title';
    const channel =
      (typeof entry.channel === 'string' && entry.channel) ||
      (typeof entry.uploader === 'string' && entry.uploader) ||
      null;

    return {
      id,
      title,
      url: `https://www.youtube.com/watch?v=${id}`,
      durationSec: duration,
      thumbnail: pickThumbnail(entry),
      channel,
      isLive,
      source: 'youtube',
      codec: null,
      seekOffsetMs: 0,
    };
  }

  /**
   * @param {string[]} args
   * @returns {Promise<any>}
   */
  async #json(args) {
    const stdout = await this.#run(args, { timeoutMs: 60_000, label: 'metadata' });
    try {
      return JSON.parse(stdout);
    } catch (error) {
      throw new UserError('YouTube returned an unexpected response. Try again in a moment.', {
        code: 'BAD_JSON',
        cause: error,
      });
    }
  }

  /**
   * Run `yt-dlp --version` and report whether the binary is getting old.
   * yt-dlp versions look like `2025.01.15` (optionally with a build suffix).
   *
   * @param {{ maxAgeDays?: number, force?: boolean }} [options]
   * @returns {Promise<{ version: string | null, ageDays: number | null, stale: boolean } | null>}
   */
  async versionStatus(options = {}) {
    const maxAgeDays = options.maxAgeDays ?? this.config.ytdlpMaxAgeDays ?? 0;
    const cacheMs = 12 * 60 * 60 * 1000;
    if (!options.force && this.versionInfo && Date.now() - this.versionCheckedAt < cacheMs) {
      return this.versionInfo;
    }

    let version;
    try {
      const stdout = await this.#run(['--version'], { timeoutMs: 20_000, label: 'version' });
      version = stdout.trim().split(/\r?\n/)[0] ?? null;
    } catch (error) {
      this.logger.debug('Could not read yt-dlp version', error);
      return null;
    }

    let ageDays = null;
    const match = version?.match(/^(\d{4})\.(\d{2})\.(\d{2})/);
    if (match) {
      const released = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
      ageDays = Math.max(0, Math.floor((Date.now() - released) / 86_400_000));
    }

    this.versionInfo = {
      version,
      ageDays,
      stale: Boolean(maxAgeDays > 0 && ageDays !== null && ageDays > maxAgeDays),
    };
    this.versionCheckedAt = Date.now();
    return this.versionInfo;
  }

  /**
   * @param {string[]} args
   * @param {{ signal?: AbortSignal, timeoutMs?: number, label?: string }} [options]
   * @returns {Promise<string>}
   */
  async #run(args, options = {}) {
    await this.semaphore.acquire();
    try {
      return await this.#spawn(args, options);
    } finally {
      this.semaphore.release();
    }
  }

  /**
   * @param {string[]} args
   * @param {{ signal?: AbortSignal, timeoutMs?: number, label?: string }} [options]
   * @returns {Promise<string>}
   */
  #spawn(args, options = {}) {
    const { signal, timeoutMs = 60_000, label = 'yt-dlp' } = options;

    return new Promise((resolve, reject) => {
      const env = {
        ...process.env,
        TEMP: this.config.tempDir,
        TMP: this.config.tempDir,
        TMPDIR: this.config.tempDir,
        PYTHONIOENCODING: 'utf-8',
        NO_COLOR: '1',
      };

      let child;
      try {
        child = spawn(this.config.ytdlpPath, args, {
          cwd: this.config.rootDir,
          env,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (error) {
        reject(
          new UserError('Could not start yt-dlp. Run "npm run setup" and check YTDLP_PATH.', {
            code: 'YTDLP_START',
            cause: error,
          }),
        );
        return;
      }

      let stdout = '';
      let stderr = '';
      let settled = false;
      let timedOut = false;
      let aborted = false;
      let stdoutBytes = 0;

      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        fn(value);
      };

      const kill = () => {
        try {
          child.kill('SIGKILL');
        } catch {
          // Process already exited.
        }
      };

      const timer = setTimeout(() => {
        timedOut = true;
        kill();
      }, timeoutMs);

      const onAbort = () => {
        aborted = true;
        kill();
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) onAbort();

      child.stdout.on('data', (chunk) => {
        stdoutBytes += chunk.length;
        if (stdoutBytes > MAX_STDOUT_BYTES) {
          kill();
          finish(reject, new UserError('YouTube returned too much data.', { code: 'OUTPUT_TOO_LARGE' }));
          return;
        }
        stdout += chunk.toString('utf8');
      });

      child.stderr.on('data', (chunk) => {
        if (stderr.length < MAX_STDERR_BYTES) stderr += chunk.toString('utf8');
      });

      child.on('error', (error) => {
        if (aborted || isAbortError(error)) {
          finish(reject, Object.assign(new Error('Aborted'), { name: 'AbortError' }));
          return;
        }
        finish(
          reject,
          new UserError('Could not start yt-dlp. Run "npm run setup" and check YTDLP_PATH.', {
            code: 'YTDLP_START',
            cause: error,
          }),
        );
      });

      child.on('close', (code) => {
        if (aborted) {
          finish(reject, Object.assign(new Error('Aborted'), { name: 'AbortError' }));
          return;
        }
        if (timedOut) {
          finish(reject, new UserError('YouTube took too long to respond. Try again.', { code: 'YTDLP_TIMEOUT' }));
          return;
        }
        if (code !== 0) {
          const details = cleanErrorMessage(stderr);
          this.logger.warn(`yt-dlp ${label} failed (code ${code})`, {
            stderr: details.slice(-1200),
          });
          finish(reject, mapYtDlpError(stderr, 'YouTube could not process that request.'));
          return;
        }
        finish(resolve, stdout);
      });
    });
  }
}
