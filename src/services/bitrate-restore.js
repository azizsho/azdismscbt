import fs from 'node:fs/promises';
import path from 'node:path';

const VERSION = 1;
const SAVE_DELAY_MS = 1000;

/**
 * @typedef {{ originalBitrate: number, appliedBitrate: number, savedAt: number }} BitrateRestore
 */

/**
 * Persist voice-channel bitrate changes so they can still be undone after a
 * crash or a hard kill (where the normal destroy path never runs).
 */
export class BitrateRestoreStore {
  /** @param {string} filePath */
  constructor(filePath) {
    this.filePath = filePath;
    /** @type {Map<string, BitrateRestore>} */
    this.entries = new Map();
    /** @type {NodeJS.Timeout | null} */
    this.saveTimer = null;
  }

  async load() {
    try {
      const parsed = JSON.parse(await fs.readFile(this.filePath, 'utf8'));
      if (parsed?.version !== VERSION || typeof parsed.entries !== 'object' || !parsed.entries) {
        return;
      }
      for (const [key, value] of Object.entries(parsed.entries)) {
        if (
          value &&
          Number.isFinite(Number(value.originalBitrate)) &&
          Number.isFinite(Number(value.appliedBitrate))
        ) {
          this.entries.set(key, {
            originalBitrate: Number(value.originalBitrate),
            appliedBitrate: Number(value.appliedBitrate),
            savedAt: Number(value.savedAt) || Date.now(),
          });
        }
      }
    } catch {
      // No saved state yet.
    }
  }

  /** @returns {Array<[string, BitrateRestore]>} */
  list() {
    return [...this.entries.entries()];
  }

  /**
   * @param {string} guildId
   * @param {string} channelId
   * @param {number} originalBitrate
   * @param {number} appliedBitrate
   */
  save(guildId, channelId, originalBitrate, appliedBitrate) {
    this.entries.set(`${guildId}:${channelId}`, {
      originalBitrate,
      appliedBitrate,
      savedAt: Date.now(),
    });
    this.#scheduleSave();
  }

  /**
   * @param {string} guildId
   * @param {string} channelId
   */
  clear(guildId, channelId) {
    if (this.entries.delete(`${guildId}:${channelId}`)) this.#scheduleSave();
  }

  #scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.flush();
    }, SAVE_DELAY_MS);
    this.saveTimer.unref?.();
  }

  async flush() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    const entries = {};
    for (const [key, value] of this.entries) entries[key] = value;
    const payload = JSON.stringify({ version: VERSION, entries });
    const tempPath = `${this.filePath}.tmp`;
    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.writeFile(tempPath, payload, 'utf8');
      await fs.rename(tempPath, this.filePath);
    } catch {
      await fs.rm(tempPath, { force: true }).catch(() => {});
    }
  }
}
