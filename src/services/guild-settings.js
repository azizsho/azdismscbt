import fs from 'node:fs/promises';
import path from 'node:path';

const VERSION = 1;
const SAVE_DELAY_MS = 1000;

/**
 * @typedef {{ autoplay?: boolean }} GuildSettings
 */

/**
 * Per-guild preferences that outlive a player and the bot process. Missing
 * entries fall back to the values from `.env`.
 */
export class GuildSettingsStore {
  /** @param {string} filePath */
  constructor(filePath) {
    this.filePath = filePath;
    /** @type {Map<string, GuildSettings>} */
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
      for (const [guildId, value] of Object.entries(parsed.entries)) {
        if (!value || typeof value !== 'object') continue;
        /** @type {GuildSettings} */
        const settings = {};
        if (typeof value.autoplay === 'boolean') settings.autoplay = value.autoplay;
        if (Object.keys(settings).length > 0) this.entries.set(guildId, settings);
      }
    } catch {
      // No saved settings yet.
    }
  }

  /**
   * @param {string} guildId
   * @returns {GuildSettings | null}
   */
  get(guildId) {
    return this.entries.get(guildId) ?? null;
  }

  /**
   * @param {string} guildId
   * @param {boolean} enabled
   */
  setAutoplay(guildId, enabled) {
    const settings = this.entries.get(guildId) ?? {};
    settings.autoplay = Boolean(enabled);
    this.entries.set(guildId, settings);
    this.#scheduleSave();
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
    for (const [guildId, value] of this.entries) entries[guildId] = value;
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
