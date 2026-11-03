import { PermissionFlagsBits } from 'discord.js';
import { GuildPlayer } from './guild-player.js';
import { UserError } from '../util/errors.js';

export class MusicManager {
  /**
   * @param {{
   *   config: ReturnType<typeof import('../config.js').loadConfig>,
   *   logger: ReturnType<typeof import('../logger.js').createLogger>,
   *   cache: import('./cache.js').MediaCache,
   *   youtube?: import('./youtube.js').YouTube,
   *   bitrateRestore?: import('../services/bitrate-restore.js').BitrateRestoreStore,
   *   settings?: import('../services/guild-settings.js').GuildSettingsStore,
   * }} options
   */
  constructor(options) {
    this.config = options.config;
    this.logger = options.logger.child('manager');
    this.cache = options.cache;
    this.youtube = options.youtube ?? options.cache?.youtube ?? null;
    this.bitrateRestore = options.bitrateRestore ?? null;
    this.settings = options.settings ?? null;
    /** @type {Map<string, boolean>} */
    this.autoplayOverrides = new Map();
    /** @type {Map<string, GuildPlayer>} */
    this.players = new Map();
  }

  /**
   * The effective autoplay setting for a guild: its stored override, or the
   * `AUTOPLAY` default from `.env`.
   *
   * @param {string} guildId
   * @returns {boolean}
   */
  getAutoplay(guildId) {
    const override = this.autoplayOverrides.get(guildId);
    if (typeof override === 'boolean') return override;

    const stored = this.settings?.get(guildId)?.autoplay;
    if (typeof stored === 'boolean') return stored;

    return this.config.autoplay;
  }

  /**
   * Persist a guild's autoplay choice. The in-memory copy keeps working even
   * when no settings store was supplied (for example in tests).
   *
   * @param {string} guildId
   * @param {boolean} enabled
   * @returns {boolean}
   */
  setAutoplay(guildId, enabled) {
    const value = Boolean(enabled);
    this.autoplayOverrides.set(guildId, value);
    this.settings?.setAutoplay(guildId, value);
    return value;
  }

  /**
   * @param {import('discord.js').Guild} guild
   * @param {import('discord.js').VoiceChannel} voiceChannel
   * @param {import('discord.js').GuildTextBasedChannel} textChannel
   */
  async getOrCreate(guild, voiceChannel, textChannel) {
    let existing = this.players.get(guild.id);
    if (existing?.destroyPromise) {
      // A player can be marked destroyed before its teardown finishes; wait for
      // the connection cleanup so a new player cannot reuse a dying connection.
      await existing.destroyPromise;
      existing = this.players.get(guild.id);
    }
    if (existing && !existing.destroyed) {
      existing.setTextChannel(textChannel);
      await existing.setVoiceChannel(voiceChannel);
      return existing;
    }

    const player = new GuildPlayer({
      guild,
      voiceChannel,
      textChannel,
      config: this.config,
      logger: this.logger,
      cache: this.cache,
      youtube: this.youtube,
      bitrateRestore: this.bitrateRestore,
      manager: this,
    });
    this.players.set(guild.id, player);
    try {
      await player.connect();
    } catch (error) {
      this.players.delete(guild.id);
      throw error;
    }
    // Fire-and-forget: the join clip must not delay /play.
    void player.playJoinSound();
    return player;
  }

  /** @param {string} guildId */
  get(guildId) {
    const player = this.players.get(guildId);
    if (!player || player.destroyed) return null;
    return player;
  }

  /** @param {string} guildId */
  require(guildId) {
    const player = this.get(guildId);
    if (!player) throw new UserError('Nothing is playing right now. Use `/play` to start some music.');
    return player;
  }

  /**
   * @param {string} guildId
   * @param {GuildPlayer} player
   */
  remove(guildId, player) {
    if (this.players.get(guildId) === player) {
      this.players.delete(guildId);
    }
  }

  /**
   * Route a Discord voice-state update to the guild's player, if any.
   *
   * @param {string} guildId
   * @param {import('discord.js').VoiceState} oldState
   * @param {import('discord.js').VoiceState} newState
   */
  handleVoiceStateUpdate(guildId, oldState, newState) {
    const player = this.players.get(guildId);
    if (player && !player.destroyed) player.handleVoiceStateUpdate(oldState, newState);
  }

  /** @param {string} trackId */
  isTrackActive(trackId) {
    for (const player of this.players.values()) {
      if (player.current?.id === trackId) return true;
      if (player.queue.tracks.some((track) => track.id === trackId)) return true;
    }
    return false;
  }

  get size() {
    return this.players.size;
  }

  /**
   * Undo bitrate boosts left behind by a crash or hard kill.
   *
   * @param {import('discord.js').Client} client
   */
  async restorePersistedBitrates(client) {
    if (!this.bitrateRestore || !this.config.restoreChannelBitrate) return;
    for (const [key, saved] of this.bitrateRestore.list()) {
      const [guildId, channelId] = key.split(':');
      const guild = client.guilds.cache.get(guildId);
      const channel = guild?.channels.cache.get(channelId);
      const voiceChannel = /** @type {import('discord.js').VoiceChannel | null} */ (channel);
      if (!voiceChannel || typeof voiceChannel.setBitrate !== 'function') {
        this.bitrateRestore.clear(guildId, channelId);
        continue;
      }
      if (voiceChannel.bitrate !== saved.appliedBitrate) {
        // Someone changed it manually; do not overwrite their value.
        this.bitrateRestore.clear(guildId, channelId);
        continue;
      }
      const me = guild.members.me;
      const permissions = me ? voiceChannel.permissionsFor(me) : null;
      if (!permissions?.has(PermissionFlagsBits.ManageChannels)) continue;
      try {
        await voiceChannel.setBitrate(saved.originalBitrate, 'Restore original channel bitrate');
        this.bitrateRestore.clear(guildId, channelId);
        this.logger.info(`Restored bitrate for ${channelId} after a restart`);
      } catch (error) {
        this.logger.warn(`Could not restore the persisted bitrate for ${channelId}`, error);
      }
    }
  }

  async destroyAll() {
    const players = [...this.players.values()];
    await Promise.allSettled(players.map((player) => player.destroy({ silent: true })));
    this.players.clear();
  }
}
