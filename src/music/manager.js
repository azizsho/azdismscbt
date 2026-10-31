import { GuildPlayer } from './guild-player.js';
import { UserError } from '../util/errors.js';

export class MusicManager {
  /**
   * @param {{
   *   config: ReturnType<typeof import('../config.js').loadConfig>,
   *   logger: ReturnType<typeof import('../logger.js').createLogger>,
   *   cache: import('./cache.js').MediaCache,
   * }} options
   */
  constructor(options) {
    this.config = options.config;
    this.logger = options.logger.child('manager');
    this.cache = options.cache;
    /** @type {Map<string, GuildPlayer>} */
    this.players = new Map();
  }

  /**
   * @param {import('discord.js').Guild} guild
   * @param {import('discord.js').VoiceChannel} voiceChannel
   * @param {import('discord.js').GuildTextBasedChannel} textChannel
   */
  async getOrCreate(guild, voiceChannel, textChannel) {
    const existing = this.players.get(guild.id);
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

  async destroyAll() {
    const players = [...this.players.values()];
    await Promise.allSettled(players.map((player) => player.destroy({ silent: true })));
    this.players.clear();
  }
}
