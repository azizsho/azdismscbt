import fs from 'node:fs/promises';
import path from 'node:path';
import { UserError, isAbortError } from '../util/errors.js';

const CACHE_FILE_RE = /^([A-Za-z0-9_-]{11})\.(webm|m4a|opus|ogg|mp3|aac|mp4)$/i;

/**
 * Content-addressed-ish audio cache. Files are named after YouTube video IDs,
 * so seeking and volume changes can re-read the same file without downloading
 * the track again.
 */
export class MediaCache {
  /**
   * @param {{
   *   dir: string,
   *   maxBytes: number,
   *   youtube: import('./youtube.js').YouTube,
   *   logger: ReturnType<typeof import('../logger.js').createLogger>,
   *   isProtected?: (id: string) => boolean,
   * }} options
   */
  constructor(options) {
    this.dir = options.dir;
    this.maxBytes = options.maxBytes;
    this.youtube = options.youtube;
    this.logger = options.logger.child('cache');
    this.isProtected = options.isProtected ?? (() => false);
    /** @type {Map<string, { path: string, size: number, lastAccess: number }>} */
    this.entries = new Map();
    /** @type {Map<string, Promise<string>>} */
    this.inflight = new Map();
    this.totalBytes = 0;
    /** @type {Promise<void> | null} */
    this.prunePromise = null;
  }

  async init() {
    await fs.mkdir(this.dir, { recursive: true });
    const files = await fs.readdir(this.dir).catch(() => []);
    for (const file of files) {
      const match = file.match(CACHE_FILE_RE);
      if (!match) continue;
      const filePath = path.join(this.dir, file);
      const stat = await fs.stat(filePath).catch(() => null);
      if (!stat?.isFile() || stat.size < 1024) continue;
      this.entries.set(match[1], {
        path: filePath,
        size: stat.size,
        lastAccess: Math.max(stat.atimeMs || 0, stat.mtimeMs || 0),
      });
      this.totalBytes += stat.size;
    }
    this.logger.info(`Cache ready: ${this.entries.size} track(s), ${(this.totalBytes / 1024 / 1024).toFixed(1)} MiB`);
    await this.prune();
  }

  /**
   * @param {import('./youtube.js').Track} track
   * @param {{ signal?: AbortSignal }} [options]
   * @returns {Promise<string>}
   */
  async ensure(track, options = {}) {
    const existing = this.entries.get(track.id);
    if (existing) {
      const stat = await fs.stat(existing.path).catch(() => null);
      if (stat?.isFile() && stat.size > 1024) {
        existing.lastAccess = Date.now();
        existing.size = stat.size;
        return existing.path;
      }
      this.entries.delete(track.id);
      this.totalBytes = Math.max(0, this.totalBytes - existing.size);
    }

    const pending = this.inflight.get(track.id);
    if (pending) return pending;

    const promise = this.#download(track, options).finally(() => {
      this.inflight.delete(track.id);
    });
    this.inflight.set(track.id, promise);
    return promise;
  }

  /**
   * @param {import('./youtube.js').Track} track
   * @param {{ signal?: AbortSignal }} [options]
   */
  async #download(track, options) {
    this.logger.debug(`Downloading ${track.id}: ${track.title}`);
    const filePath = await this.youtube.download(track, { signal: options.signal });
    const stat = await fs.stat(filePath);
    if (!stat.isFile() || stat.size < 1024) {
      throw new UserError('The downloaded audio file is empty. Try another video.', { code: 'DOWNLOAD_EMPTY' });
    }

    // yt-dlp writes `<id>.<ext>`; normalise the extension casing just in case.
    const current = this.entries.get(track.id);
    if (current && current.path !== filePath) {
      this.totalBytes = Math.max(0, this.totalBytes - current.size);
    }
    this.entries.set(track.id, { path: filePath, size: stat.size, lastAccess: Date.now() });
    this.totalBytes += stat.size;

    // Pruning is best-effort and must never fail a playback.
    this.prune().catch((error) => {
      if (!isAbortError(error)) this.logger.warn('Cache prune failed', error);
    });

    return filePath;
  }

  /** Delete the least-recently-used files until the cache is under its limit. */
  async prune() {
    if (this.prunePromise) return this.prunePromise;
    if (this.totalBytes <= this.maxBytes) return;

    // Serialize pruning: concurrent downloads can otherwise prune the same
    // entries twice, subtract their size twice, or delete a file that was
    // replaced while the previous pass was awaiting the filesystem.
    this.prunePromise = this.#prune().finally(() => {
      this.prunePromise = null;
    });
    return this.prunePromise;
  }

  async #prune() {
    const candidates = [...this.entries.entries()]
      .filter(([id]) => !this.isProtected(id) && !this.inflight.has(id))
      .sort((a, b) => a[1].lastAccess - b[1].lastAccess);

    for (const [id, entry] of candidates) {
      if (this.totalBytes <= this.maxBytes) break;
      // The entry may have been replaced or downloaded again while we were
      // waiting for the previous delete.
      if (this.entries.get(id) !== entry || this.inflight.has(id)) continue;
      this.entries.delete(id);
      this.totalBytes = Math.max(0, this.totalBytes - entry.size);
      await fs.rm(entry.path, { force: true }).catch((error) => {
        this.logger.warn(`Could not delete cached file ${entry.path}`, error);
      });
    }

    if (this.totalBytes > this.maxBytes) {
      this.logger.warn('Cache is over its size limit but all remaining tracks are active.');
    }
  }

  getStats() {
    return {
      count: this.entries.size,
      totalBytes: this.totalBytes,
      maxBytes: this.maxBytes,
    };
  }

  /** @param {string} trackId */
  has(trackId) {
    return this.entries.has(trackId);
  }

  /** Remove every cached file. Used by tests and maintenance scripts. */
  async clear() {
    const files = await fs.readdir(this.dir).catch(() => []);
    await Promise.all(files.map((file) => fs.rm(path.join(this.dir, file), { force: true }).catch(() => {})));
    this.entries.clear();
    this.totalBytes = 0;
  }
}
