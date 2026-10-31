import fs from 'node:fs/promises';
import path from 'node:path';
import { UserError, isAbortError } from '../util/errors.js';

const CACHE_FILE_RE = /^([A-Za-z0-9_-]{11})\.(webm|m4a|opus|ogg|mp3|aac|mp4)$/i;
const PARTIAL_FILE_RE = /\.(part|ytdl|download)$/i;
const INDEX_FILE = 'index.json';
const MIN_FREE_BYTES = 200 * 1024 * 1024;
const INDEX_SAVE_DELAY_MS = 2000;

/** @returns {Error} */
function abortError() {
  return Object.assign(new Error('Aborted'), { name: 'AbortError' });
}

/**
 * Content-addressed-ish audio cache. Files are named after YouTube video IDs,
 * so seeking and volume changes can re-read the same file without downloading
 * the track again.
 *
 * Downloads are owned by the cache, not by the caller that started them: a
 * caller's AbortSignal only cancels that caller's wait, so one guild/preload
 * aborting cannot reject another caller's shared download.
 */
export class MediaCache {
  /**
   * @param {{
   *   dir: string,
   *   maxBytes: number,
   *   youtube: import('./youtube.js').YouTube,
   *   logger: ReturnType<typeof import('../logger.js').createLogger>,
   *   isProtected?: (id: string) => boolean,
   *   tempDir?: string | null,
   * }} options
   */
  constructor(options) {
    this.dir = options.dir;
    this.maxBytes = options.maxBytes;
    this.youtube = options.youtube;
    this.logger = options.logger.child('cache');
    this.isProtected = options.isProtected ?? (() => false);
    this.tempDir = options.tempDir ?? null;
    /** @type {Map<string, { path: string, size: number, lastAccess: number }>} */
    this.entries = new Map();
    /** @type {Map<string, { controller: AbortController, promise: Promise<string> }>} */
    this.inflight = new Map();
    this.totalBytes = 0;
    /** @type {Promise<void> | null} */
    this.prunePromise = null;
    /** @type {NodeJS.Timeout | null} */
    this.indexSaveTimer = null;
  }

  /** @param {{ prune?: boolean }} [options] */
  async init({ prune = true } = {}) {
    await fs.mkdir(this.dir, { recursive: true });
    await this.#cleanTempDir();

    const files = await fs.readdir(this.dir).catch(() => []);
    /** @type {Map<string, Array<{ filePath: string, size: number, lastAccess: number }>>} */
    const byId = new Map();
    for (const file of files) {
      if (PARTIAL_FILE_RE.test(file)) {
        await fs.rm(path.join(this.dir, file), { force: true }).catch(() => {});
        continue;
      }
      const match = file.match(CACHE_FILE_RE);
      if (!match) continue;
      const filePath = path.join(this.dir, file);
      const stat = await fs.stat(filePath).catch(() => null);
      if (!stat?.isFile() || stat.size < 1024) continue;
      const list = byId.get(match[1]) ?? [];
      list.push({ filePath, size: stat.size, lastAccess: Math.max(stat.atimeMs || 0, stat.mtimeMs || 0) });
      byId.set(match[1], list);
    }

    const index = await this.#loadIndex();
    for (const [id, list] of byId) {
      // Keep one file per video ID; remove stale alternate-extension copies.
      list.sort((a, b) => b.lastAccess - a.lastAccess);
      const [keep, ...orphans] = list;
      for (const orphan of orphans) {
        await fs.rm(orphan.filePath, { force: true }).catch(() => {});
      }
      const lastAccess = Math.max(keep.lastAccess, index.get(id) ?? 0);
      this.entries.set(id, { path: keep.filePath, size: keep.size, lastAccess });
      this.totalBytes += keep.size;
    }

    this.#scheduleIndexSave();
    this.logger.info(`Cache ready: ${this.entries.size} track(s), ${(this.totalBytes / 1024 / 1024).toFixed(1)} MiB`);
    if (prune) await this.prune();
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
        this.#scheduleIndexSave();
        return existing.path;
      }
      this.entries.delete(track.id);
      this.totalBytes = Math.max(0, this.totalBytes - existing.size);
    }

    const pending = this.inflight.get(track.id);
    if (pending) return this.#waitWithSignal(pending.promise, options.signal);

    const controller = new AbortController();
    const promise = this.#download(track, controller.signal).finally(() => {
      this.inflight.delete(track.id);
    });
    this.inflight.set(track.id, { controller, promise });
    return this.#waitWithSignal(promise, options.signal);
  }

  /**
   * Wait for a shared download, but let this caller's signal cancel only its
   * own wait. The underlying download keeps running for other waiters.
   *
   * @param {Promise<string>} shared
   * @param {AbortSignal | undefined} signal
   * @returns {Promise<string>}
   */
  #waitWithSignal(shared, signal) {
    if (!signal) return shared;
    if (signal.aborted) return Promise.reject(abortError());
    return new Promise((resolve, reject) => {
      const onAbort = () => reject(abortError());
      signal.addEventListener('abort', onAbort, { once: true });
      shared.then(
        (value) => {
          signal.removeEventListener('abort', onAbort);
          resolve(value);
        },
        (error) => {
          signal.removeEventListener('abort', onAbort);
          reject(error);
        },
      );
    });
  }

  /** Cancel every in-flight download (used during process shutdown). */
  abortAll() {
    for (const entry of this.inflight.values()) {
      try {
        entry.controller.abort();
      } catch {
        // Already aborted.
      }
    }
    this.inflight.clear();
  }

  /**
   * @param {import('./youtube.js').Track} track
   * @param {AbortSignal} signal
   */
  async #download(track, signal) {
    this.logger.debug(`Downloading ${track.id}: ${track.title}`);
    await this.#ensureDiskSpace();
    const filePath = await this.youtube.download(track, { signal });
    const stat = await fs.stat(filePath);
    if (!stat.isFile() || stat.size < 1024) {
      throw new UserError('The downloaded audio file is empty. Try another video.', { code: 'DOWNLOAD_EMPTY' });
    }

    const current = this.entries.get(track.id);
    if (current) {
      this.totalBytes = Math.max(0, this.totalBytes - current.size);
      if (current.path !== filePath) {
        await fs.rm(current.path, { force: true }).catch(() => {});
      }
    }
    this.entries.set(track.id, { path: filePath, size: stat.size, lastAccess: Date.now() });
    this.totalBytes += stat.size;
    this.#scheduleIndexSave();

    // Pruning is best-effort and must never fail a playback.
    this.prune().catch((error) => {
      if (!isAbortError(error)) this.logger.warn('Cache prune failed', error);
    });

    return filePath;
  }

  async #ensureDiskSpace() {
    try {
      const stats = await fs.statfs(this.dir);
      const free = Number(stats.bavail) * Number(stats.bsize);
      if (free >= MIN_FREE_BYTES) return;
      this.logger.warn(`Low disk space (${(free / 1024 / 1024).toFixed(0)} MiB free); pruning before download`);
      await this.prune();
      const after = await fs.statfs(this.dir);
      const freeAfter = Number(after.bavail) * Number(after.bsize);
      if (freeAfter < MIN_FREE_BYTES) {
        throw new UserError('Not enough free disk space to download audio. Free some space and try again.', {
          code: 'DISK_FULL',
        });
      }
    } catch (error) {
      if (error instanceof UserError) throw error;
      // statfs is unavailable on some filesystems; skip the preflight.
    }
  }

  async #cleanTempDir() {
    if (!this.tempDir) return;
    const names = await fs.readdir(this.tempDir).catch(() => []);
    const meis = names.filter((name) => name.startsWith('_MEI'));
    await Promise.all(
      meis.map((name) =>
        fs.rm(path.join(this.tempDir, name), { recursive: true, force: true }).catch(() => {}),
      ),
    );
    if (meis.length > 0) this.logger.info(`Removed ${meis.length} stale temp bundle(s)`);
  }

  get #indexPath() {
    return path.join(this.dir, INDEX_FILE);
  }

  /** @returns {Promise<Map<string, number>>} */
  async #loadIndex() {
    try {
      const raw = await fs.readFile(this.#indexPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed?.version !== 1 || typeof parsed.entries !== 'object' || !parsed.entries) {
        return new Map();
      }
      /** @type {Map<string, number>} */
      const index = new Map();
      for (const [id, value] of Object.entries(parsed.entries)) {
        const accessedAt = Number(value);
        if (Number.isFinite(accessedAt) && accessedAt > 0) index.set(id, accessedAt);
      }
      return index;
    } catch {
      return new Map();
    }
  }

  #scheduleIndexSave() {
    if (this.indexSaveTimer) return;
    this.indexSaveTimer = setTimeout(() => {
      this.indexSaveTimer = null;
      void this.#saveIndex();
    }, INDEX_SAVE_DELAY_MS);
    this.indexSaveTimer.unref?.();
  }

  async #saveIndex() {
    const entries = {};
    for (const [id, entry] of this.entries) entries[id] = entry.lastAccess;
    const payload = JSON.stringify({ version: 1, entries });
    const tempPath = `${this.#indexPath}.tmp`;
    try {
      await fs.writeFile(tempPath, payload, 'utf8');
      await fs.rename(tempPath, this.#indexPath);
    } catch (error) {
      this.logger.debug('Could not persist the cache index', error);
      await fs.rm(tempPath, { force: true }).catch(() => {});
    }
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
    this.#scheduleIndexSave();
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
    await this.#saveIndex();
  }
}
