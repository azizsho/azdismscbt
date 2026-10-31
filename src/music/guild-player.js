import {
  AudioPlayerStatus,
  NoSubscriberBehavior,
  VoiceConnectionStatus,
  createAudioPlayer,
  entersState,
  getVoiceConnection,
  joinVoiceChannel,
} from '@discordjs/voice';
import { PermissionFlagsBits } from 'discord.js';
import { createPlaybackResource, probeAudioCodec } from './audio.js';
import { TrackQueue } from './queue.js';
import { UserError, isAbortError } from '../util/errors.js';
import { nowPlayingEmbed, queueBoardEmbed, errorEmbed, successEmbed, QUEUE_PREVIEW_LIMIT } from '../ui/embeds.js';
import { nowPlayingButtons } from '../ui/components.js';

const TIER_MAX_KBPS = [96, 128, 256, 384];

/**
 * One bot instance per Discord guild. Owns the voice connection, audio player,
 * queue, current track, and all playback state.
 */
export class GuildPlayer {
  /**
   * @param {{
   *   guild: import('discord.js').Guild,
   *   voiceChannel: import('discord.js').VoiceChannel,
   *   textChannel: import('discord.js').GuildTextBasedChannel,
   *   config: ReturnType<typeof import('../config.js').loadConfig>,
   *   logger: ReturnType<typeof import('../logger.js').createLogger>,
   *   cache: import('./cache.js').MediaCache,
   *   youtube?: import('./youtube.js').YouTube | null,
   *   bitrateRestore?: import('../services/bitrate-restore.js').BitrateRestoreStore | null,
   *   manager: import('./manager.js').MusicManager,
   * }} options
   */
  constructor(options) {
    this.guild = options.guild;
    this.voiceChannel = options.voiceChannel;
    this.voiceChannelId = options.voiceChannel.id;
    this.textChannel = options.textChannel;
    this.config = options.config;
    this.logger = options.logger.child(`guild:${options.guild.id}`);
    this.cache = options.cache;
    this.youtube = options.youtube ?? options.cache?.youtube ?? null;
    this.bitrateRestore = options.bitrateRestore ?? null;
    this.manager = options.manager;

    this.queue = new TrackQueue(options.config.maxQueueSize);
    this.queue.onChange = () => this.#scheduleQueueBoardUpdate();
    this.player = createAudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Pause },
    });

    /** @type {import('@discordjs/voice').VoiceConnection | null} */
    this.connection = null;
    this.connectionListenersAttached = false;

    /** @type {import('./youtube.js').Track | null} */
    this.current = null;
    this.currentFilePath = null;
    this.currentCleanup = null;
    this.seekOffsetMs = 0;
    this.generation = 0;
    this.starting = false;
    this.destroyed = false;
    this.closing = false;
    this.recovering = false;
    this.failureCount = 0;
    /** @type {Promise<void> | null} */
    this.destroyPromise = null;
    this.bitrateKbps = 64;
    this.audioMode = '—';
    /** @type {Map<string, { originalBitrate: number, appliedBitrate: number }>} */
    this.bitrateRestores = new Map();

    /** @type {NodeJS.Timeout | null} */
    this.idleTimer = null;
    /** @type {NodeJS.Timeout | null} */
    this.aloneTimer = null;
    this.autoPausedByEmpty = false;
    this.autoplaying = false;
    /** @type {AbortController | null} */
    this.abortController = null;
    /** @type {Promise<void> | null} */
    this.preloadTask = null;
    this.preloadAbort = new AbortController();
    /** @type {Set<string>} */
    this.preloadInFlight = new Set();
    /** @type {Set<string>} */
    this.preloadFailed = new Set();

    this.loopMode = 'off';
    this.volume = options.config.defaultVolume;
    this.history = [];
    /** @type {import('discord.js').Message | null} */
    this.nowPlayingMessage = null;
    /** @type {import('discord.js').Message | null} */
    this.queueMessage = null;
    /** @type {NodeJS.Timeout | null} */
    this.nowPlayingTimer = null;
    /** @type {NodeJS.Timeout | null} */
    this.queueBoardTimer = null;
    this.queueBoardSignature = '';
    this.nowPlayingGeneration = 0;
    this.playingSound = false;

    this.player.on('error', (error) => {
      this.logger.error('Audio player error', error);
      this.#notify(errorEmbed(this.config, 'The audio stream failed. Trying the next track…')).catch(() => {});
    });
    this.player.on(AudioPlayerStatus.Idle, () => this.#onIdle());
    this.player.on(AudioPlayerStatus.Playing, () => {
      this.failureCount = 0;
      this.logger.debug('Playback started');
    });
  }

  get isPaused() {
    return (
      this.player.state.status === AudioPlayerStatus.Paused ||
      this.player.state.status === AudioPlayerStatus.AutoPaused
    );
  }

  get isPlaying() {
    return this.player.state.status === AudioPlayerStatus.Playing;
  }

  get autoplay() {
    const configured = this.manager?.getAutoplay?.(this.guild.id);
    return typeof configured === 'boolean' ? configured : this.config.autoplay;
  }

  get positionMs() {
    if (!this.current) return 0;
    const state = this.player.state;
    const played = 'playbackDuration' in state ? state.playbackDuration : 0;
    return this.seekOffsetMs + played;
  }

  /** @param {import('discord.js').GuildTextBasedChannel} channel */
  setTextChannel(channel) {
    this.textChannel = channel;
  }

  /**
   * Move to a different voice channel without losing the queue.
   * @param {import('discord.js').VoiceChannel} channel
   */
  async setVoiceChannel(channel) {
    if (this.voiceChannelId === channel.id) return;
    this.voiceChannel = channel;
    this.voiceChannelId = channel.id;

    if (this.connection && this.connection.state.status !== VoiceConnectionStatus.Destroyed) {
      try {
        this.connection.rejoin({
          channelId: channel.id,
          selfDeaf: true,
          selfMute: false,
        });
      } catch (error) {
        this.logger.warn('Could not move voice channel; reconnecting', error);
        this.connection.destroy();
        this.connection = null;
      }
    }
    setImmediate(() => this.#refreshAloneState());
  }

  /**
   * React to voice-state changes: keep the cached channel in sync when the bot
   * is moved, and pause/leave when the channel is empty.
   *
   * @param {import('discord.js').VoiceState} oldState
   * @param {import('discord.js').VoiceState} newState
   */
  handleVoiceStateUpdate(oldState, newState) {
    if (this.destroyed) return;
    const botId = this.guild.members.me?.id;
    if (botId && newState.id === botId) {
      const channelId = newState.channelId;
      if (channelId && channelId !== this.voiceChannelId) {
        const channel = this.guild.channels.cache.get(channelId);
        if (channel && typeof channel.permissionsFor === 'function') {
          this.voiceChannel = /** @type {import('discord.js').VoiceChannel} */ (channel);
          this.voiceChannelId = channelId;
          this.logger.info(`Moved to voice channel ${channelId}`);
        }
      }
      this.#refreshAloneState();
      return;
    }
    if (oldState.channelId === this.voiceChannelId || newState.channelId === this.voiceChannelId) {
      this.#refreshAloneState();
    }
  }

  #refreshAloneState() {
    if (this.destroyed) return;
    const members = this.voiceChannel?.members;
    const humans = members ? [...members.values()].filter((member) => !member.user.bot).length : 1;

    if (humans > 0) {
      this.#clearAloneTimer();
      if (this.autoPausedByEmpty) {
        this.autoPausedByEmpty = false;
        if (this.player.state.status === AudioPlayerStatus.Paused) {
          try {
            this.player.unpause();
          } catch {
            // Already resumed.
          }
        }
        void this.#refreshNowPlaying(true);
      }
      return;
    }

    if (this.config.pauseWhenAlone && this.current && !this.isPaused) {
      this.autoPausedByEmpty = true;
      try {
        this.player.pause();
      } catch {
        // Nothing playing.
      }
      void this.#refreshNowPlaying(true);
    }

    if (this.config.leaveWhenAloneSeconds > 0 && !this.aloneTimer) {
      this.aloneTimer = setTimeout(() => {
        this.aloneTimer = null;
        if (this.destroyed) return;
        const stillAlone = !(
          this.voiceChannel?.members && [...this.voiceChannel.members.values()].some((member) => !member.user.bot)
        );
        if (stillAlone) {
          this.logger.info('Voice channel is empty; leaving');
          void this.destroy().catch(() => {});
        }
      }, this.config.leaveWhenAloneSeconds * 1000);
      this.aloneTimer.unref?.();
    }
  }

  #clearAloneTimer() {
    if (this.aloneTimer) {
      clearTimeout(this.aloneTimer);
      this.aloneTimer = null;
    }
  }

  async connect() {
    if (this.destroyed) throw new UserError('This player is closed.');

    const existing = getVoiceConnection(this.guild.id);
    if (
      existing &&
      existing.state.status !== VoiceConnectionStatus.Destroyed &&
      existing.joinConfig.channelId === this.voiceChannelId
    ) {
      this.connection = existing;
    } else {
      if (existing && existing.state.status !== VoiceConnectionStatus.Destroyed) {
        existing.destroy();
      }
      try {
        this.connection = joinVoiceChannel({
          channelId: this.voiceChannelId,
          guildId: this.guild.id,
          adapterCreator: this.guild.voiceAdapterCreator,
          selfDeaf: true,
          selfMute: false,
        });
        this.connectionListenersAttached = false;
      } catch (error) {
        throw new UserError('I could not join that voice channel. Check my Connect and Speak permissions.', {
          code: 'VOICE_JOIN',
          cause: error,
        });
      }
    }

    // A join/leave clip temporarily owns the connection. Subscribing the music
    // player here would steal it and cut the clip off, so wait for #playSound
    // to hand the connection back.
    if (!this.playingSound) this.connection.subscribe(this.player);
    this.#attachConnectionListeners();
    setImmediate(() => this.#refreshAloneState());
  }

  #attachConnectionListeners() {
    if (!this.connection || this.connectionListenersAttached) return;
    this.connectionListenersAttached = true;

    this.connection.on(VoiceConnectionStatus.Disconnected, () => {
      this.logger.warn('Voice connection disconnected; trying to recover');
      void this.#recoverConnection(this.connection);
    });
    this.connection.on(VoiceConnectionStatus.Destroyed, () => {
      if (this.destroyed) return;
      this.logger.warn('Voice connection destroyed');
      this.#handleExternalDisconnect();
    });
    this.connection.on('error', (error) => {
      this.logger.error('Voice connection error', error);
    });
  }

  /**
   * Survive a transient voice disconnect without losing the queue. Discord
   * frequently moves a session to a new voice server; @discordjs/voice can
   * usually recover on its own, but after that we try a bounded number of
   * manual rejoins before giving up.
   *
   * @param {import('@discordjs/voice').VoiceConnection | null} connection
   */
  async #recoverConnection(connection) {
    if (!connection || this.destroyed || this.recovering) return;
    this.recovering = true;
    try {
      // Give the library a chance to move to the new voice server by itself.
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
        await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
        this.logger.info('Voice connection recovered automatically');
        return;
      } catch {
        // Fall through to a manual rejoin.
      }

      if (this.destroyed || this.connection !== connection) return;
      if (connection.state.status === VoiceConnectionStatus.Ready) return;

      for (let attempt = 1; attempt <= 2; attempt++) {
        if (this.destroyed || this.connection !== connection) return;
        try {
          if (!connection.rejoin()) break;
          await entersState(connection, VoiceConnectionStatus.Ready, 10_000);
          this.logger.info(`Voice connection recovered after rejoin attempt ${attempt}`);
          return;
        } catch (error) {
          this.logger.warn(`Voice rejoin attempt ${attempt} failed`, error);
        }
      }

      if (this.destroyed || this.connection !== connection) return;
      this.logger.warn('Could not recover the voice connection; disconnecting');
      try {
        connection.destroy();
      } catch (error) {
        this.logger.warn('Could not destroy the unrecoverable voice connection', error);
      }
    } finally {
      this.recovering = false;
    }
  }

  #handleExternalDisconnect() {
    const wasCurrent = this.current;
    this.destroyed = true;
    this.generation++;
    this.abortController?.abort();
    this.preloadAbort?.abort();
    this.#clearIdleTimer();
    this.#clearAloneTimer();
    void this.#removeNowPlaying();
    void this.#restoreChannelBitrate();
    this.currentCleanup?.();
    this.currentCleanup = null;
    this.current = null;
    this.starting = false;
    this.queue.clear();
    try {
      this.player.stop(true);
    } catch {
      // Already idle.
    }
    this.connection = null;
    this.manager.remove(this.guild.id, this);

    if (wasCurrent) {
      this.#notify(errorEmbed(this.config, 'I lost the voice connection, so playback stopped.')).catch(() => {});
    }
  }

  /**
   * @param {import('./youtube.js').Track} track
   * @param {{ next?: boolean }} [options]
   */
  enqueue(track, options = {}) {
    if (this.destroyed) throw new UserError('This player is closed.');
    track.seekOffsetMs = 0;
    this.preloadFailed.delete(track.id);
    const position = options.next ? this.queue.addNext(track) : this.queue.add(track);
    this.#clearIdleTimer();

    if (!this.current && !this.starting) {
      void this.playNext().catch((error) => {
        this.logger.error('playNext failed after enqueue', error);
      });
    } else if (!this.starting) {
      // Do not compete with the foreground track while it is still downloading.
      this.#startPreload();
    }
    return position;
  }

  /** Start the next queued track. */
  async playNext() {
    if (this.destroyed || this.current || this.starting) return;

    const track = this.queue.shift();
    if (!track) {
      void this.#removeNowPlaying();
      this.#scheduleIdleDisconnect();
      return;
    }

    this.starting = true;
    this.current = track;
    this.seekOffsetMs = 0;
    this.currentFilePath = null;
    const generation = ++this.generation;

    this.abortController = new AbortController();
    const signal = this.abortController.signal;
    this.#clearIdleTimer();

    try {
      await this.connect();
      if (generation !== this.generation) return;

      const filePath = await this.cache.ensure(track, { signal });
      if (generation !== this.generation) return;
      this.currentFilePath = filePath;

      let codec = track.codec ?? null;
      if (!codec) {
        codec = await probeAudioCodec(filePath, this.config.ffmpegPath);
        track.codec = codec;
      }
      if (generation !== this.generation) return;

      const bitrateKbps = await this.#resolveBitrate();
      if (generation !== this.generation) return;

      const playback = createPlaybackResource({
        filePath,
        codec,
        seekMs: 0,
        volume: this.volume,
        normalize: this.config.audioNormalize,
        bitrateKbps,
        ffmpegPath: this.config.ffmpegPath,
        tempDir: this.config.tempDir,
        logger: this.logger,
      });

      this.currentCleanup = playback.cleanup;
      this.player.play(playback.resource);
      this.audioMode = playback.copy ? 'Opus passthrough' : `Opus ${bitrateKbps}k`;
      this.#sendNowPlaying();
      if (this.config.preloadAhead > 0) this.#startPreload();
      this.#watchCompletion(generation, track, playback);
      this.logger.info(
        `Playing "${track.title}" (${track.id})${playback.copy ? ' [Opus passthrough]' : ` [Opus ${bitrateKbps}k encode]`}`,
      );
    } catch (error) {
      if (generation !== this.generation || isAbortError(error)) return;
      this.logger.error(`Could not play ${track.id}`, error);
      this.current = null;
      this.starting = false;
      this.currentCleanup?.();
      this.currentCleanup = null;
      this.#notify(
        errorEmbed(this.config, `I could not play **${track.title}**.\n${error instanceof UserError ? error.message : 'See the bot logs for details.'}`),
      ).catch(() => {});
      // Move on, but don't spin forever on a broken queue.
      this.failureCount = (this.failureCount ?? 0) + 1;
      if (this.failureCount <= 3) {
        setImmediate(() => {
          void this.playNext().catch((nextError) => this.logger.error('Failed to advance queue', nextError));
        });
      } else {
        this.logger.error('Stopping after 3 consecutive playback failures');
        this.queue.clear();
        void this.#removeNowPlaying();
        this.#scheduleIdleDisconnect();
      }
    } finally {
      if (generation === this.generation) this.starting = false;
    }
  }

  /**
   * @param {number} generation
   * @param {import('./youtube.js').Track} track
   * @param {ReturnType<typeof createPlaybackResource>} playback
   */
  #watchCompletion(generation, track, playback) {
    playback.completion
      .then((result) => {
        if (generation !== this.generation) return;
        if (result.code === 0) {
          this.failureCount = 0;
          return;
        }
        this.logger.warn(`ffmpeg failed for ${track.id}`, { code: result.code, stderr: result.stderr });
        if (!this.current || this.current !== track) return;
        this.#notify(errorEmbed(this.config, 'The audio stream ended unexpectedly. Skipping…')).catch(() => {});
        // Usually the stream end already moves the player to Idle. This is a
        // safety net for the case where it does not.
        setImmediate(() => {
          if (this.current === track && !this.destroyed) {
            try {
              this.skip(1);
            } catch (error) {
              this.logger.warn('Could not skip after playback failure', error);
            }
          }
        });
      })
      .catch((error) => this.logger.warn('ffmpeg completion watcher failed', error));
  }

  /**
   * Keep the next PRELOAD_AHEAD tracks on disk. Downloads are sequential per
   * worker and always pick the earliest uncached track in that window.
   */
  #startPreload() {
    if (
      this.destroyed ||
      this.config.preloadAhead <= 0 ||
      this.preloadTask ||
      !this.#hasPreloadCandidate()
    ) {
      return;
    }

    this.preloadTask = this.#preloadLoop()
      .catch((error) => {
        if (!isAbortError(error)) this.logger.warn('Queue preload stopped unexpectedly', error);
      })
      .finally(() => {
        this.preloadTask = null;
        if (!this.destroyed && this.#hasPreloadCandidate()) {
          setImmediate(() => this.#startPreload());
        }
      });
  }

  #hasPreloadCandidate() {
    return this.queue.tracks
      .slice(0, this.config.preloadAhead)
      .some(
        (track) =>
          !this.cache.has(track.id) &&
          !this.preloadInFlight.has(track.id) &&
          !this.preloadFailed.has(track.id),
      );
  }

  async #preloadLoop() {
    const signal = this.preloadAbort.signal;
    const workerCount = Math.max(
      1,
      Math.min(this.config.preloadConcurrency ?? 1, this.config.preloadAhead),
    );
    await Promise.all(
      Array.from({ length: workerCount }, () => this.#preloadWorker(signal)),
    );
  }

  async #preloadWorker(signal) {
    while (!this.destroyed && !signal.aborted) {
      const track = this.#nextPreloadTrack();
      if (!track) return;

      this.preloadInFlight.add(track.id);
      try {
        this.logger.debug(`Preloading ${track.id}: ${track.title}`);
        await this.cache.ensure(track, { signal });
      } catch (error) {
        if (isAbortError(error)) return;
        this.preloadFailed.add(track.id);
        this.logger.warn(`Preload failed for ${track.id}`, error);
      } finally {
        this.preloadInFlight.delete(track.id);
      }
    }
  }

  #nextPreloadTrack() {
    const window = this.queue.tracks.slice(0, this.config.preloadAhead);
    return window.find(
      (track) =>
        !this.cache.has(track.id) &&
        !this.preloadInFlight.has(track.id) &&
        !this.preloadFailed.has(track.id),
    );
  }

  async #resolveBitrate() {
    const tier = Number(this.guild.premiumTier) || 0;
    const tierMax = TIER_MAX_KBPS[tier] ?? TIER_MAX_KBPS[0];
    const desired = Math.max(32, Math.min(tierMax, this.config.maxBitrateKbps));
    let current = Math.round((this.voiceChannel.bitrate ?? 64000) / 1000);
    const original = current;

    if (this.config.autoSetChannelBitrate && current < desired) {
      const me = this.guild.members.me;
      const permissions = me ? this.voiceChannel.permissionsFor(me) : null;
      if (permissions?.has(PermissionFlagsBits.ManageChannels)) {
        try {
          await this.voiceChannel.setBitrate(desired * 1000, 'Music bot audio quality');
          current = desired;
          if (this.config.restoreChannelBitrate && !this.bitrateRestores.has(this.voiceChannelId)) {
            this.bitrateRestores.set(this.voiceChannelId, {
              originalBitrate: original * 1000,
              appliedBitrate: desired * 1000,
            });
            this.bitrateRestore?.save(
              this.guild.id,
              this.voiceChannelId,
              original * 1000,
              desired * 1000,
            );
          }
          this.logger.info(`Set voice channel bitrate to ${desired} kbps`);
        } catch (error) {
          this.logger.warn(`Could not raise voice channel bitrate to ${desired} kbps`, error);
        }
      }
    }

    this.bitrateKbps = Math.max(32, Math.min(desired, current || desired));
    return this.bitrateKbps;
  }

  /**
   * Undo the channel bitrate changes, but only when a channel still has the
   * value this player applied. A user's manual change is never overwritten.
   */
  async #restoreChannelBitrate() {
    const restores = [...this.bitrateRestores.entries()];
    this.bitrateRestores.clear();
    if (!this.config.restoreChannelBitrate) return;

    for (const [channelId, restore] of restores) {
      try {
        const channel =
          this.guild.channels.cache.get(channelId) ??
          (this.voiceChannelId === channelId ? this.voiceChannel : null);
        const voiceChannel = /** @type {import('discord.js').VoiceChannel | null} */ (channel);
        if (
          !voiceChannel ||
          typeof voiceChannel.setBitrate !== 'function' ||
          voiceChannel.bitrate !== restore.appliedBitrate
        ) {
          this.bitrateRestore?.clear(this.guild.id, channelId);
          continue;
        }
        await voiceChannel.setBitrate(restore.originalBitrate, 'Restore original channel bitrate');
        this.bitrateRestore?.clear(this.guild.id, channelId);
        this.logger.info(
          `Restored voice channel bitrate to ${Math.round(restore.originalBitrate / 1000)} kbps`,
        );
      } catch (error) {
        this.logger.warn('Could not restore the original voice channel bitrate', error);
      }
    }
  }

  #onIdle() {
    if (this.destroyed || !this.current) return;

    const finished = this.current;
    this.current = null;
    this.currentFilePath = null;
    this.seekOffsetMs = 0;
    this.currentCleanup?.();
    this.currentCleanup = null;
    this.starting = false;

    this.history.unshift({ ...finished, playedAt: Date.now() });
    this.history = this.history.slice(0, 50);

    if (this.loopMode === 'track') {
      try {
        this.queue.addNext(finished);
      } catch (error) {
        this.logger.warn('Could not loop track because the queue is full', error);
      }
    } else if (this.loopMode === 'queue') {
      try {
        this.queue.add(finished);
      } catch (error) {
        this.logger.warn('Could not loop queue because it is full', error);
      }
    }

    if (this.queue.length > 0) {
      void this.playNext().catch((error) => this.logger.error('Failed to advance queue', error));
    } else if (this.autoplay && this.loopMode === 'off') {
      void this.#autoplay(finished);
    } else {
      void this.#removeNowPlaying();
      this.#scheduleIdleDisconnect();
    }
  }

  /**
   * Append related tracks when the queue drains naturally.
   *
   * @param {import('./youtube.js').Track} seed
   */
  async #autoplay(seed) {
    if (!this.youtube || !seed?.id || this.destroyed) {
      void this.#removeNowPlaying();
      this.#scheduleIdleDisconnect();
      return;
    }
    this.autoplaying = true;
    const generation = this.generation;
    try {
      const related = await this.youtube.related(seed.id, this.config.autoplayAdd ?? 5);
      if (this.destroyed || generation !== this.generation || this.current || this.queue.length > 0) {
        return;
      }
      const seen = new Set([seed.id, ...this.history.map((track) => track.id)]);
      let added = 0;
      for (const track of related) {
        if (seen.has(track.id) || this.queue.length >= this.config.maxQueueSize) continue;
        seen.add(track.id);
        track.requester = { id: 'autoplay', username: 'autoplay', displayName: 'Autoplay' };
        try {
          this.enqueue(track);
          added++;
        } catch {
          break;
        }
      }
      if (added > 0) this.logger.info(`Autoplay queued ${added} related track(s)`);
    } catch (error) {
      this.logger.debug('Autoplay lookup failed', error);
    } finally {
      this.autoplaying = false;
      if (!this.destroyed && !this.current && this.queue.isEmpty) {
        void this.#removeNowPlaying();
        this.#scheduleIdleDisconnect();
      }
    }
  }

  /**
   * Skip the current track and optionally some upcoming tracks.
   * @param {number} [count]
   * @returns {{ skipped: import('./youtube.js').Track | null, removedUpcoming: number }}
   */
  skip(count = 1) {
    if (this.destroyed) throw new UserError('This player is closed.');
    const skipped = this.current;
    if (!skipped && this.queue.isEmpty) throw new UserError('Nothing is playing.');

    this.generation++;
    this.abortController?.abort();
    this.abortController = null;
    this.current = null;
    this.currentFilePath = null;
    this.seekOffsetMs = 0;
    this.starting = false;
    this.currentCleanup?.();
    this.currentCleanup = null;
    this.player.stop(true);

    const removedUpcoming = Math.max(0, Math.min(count - 1, this.queue.length));
    this.queue.skip(removedUpcoming);

    void this.playNext().catch((error) => this.logger.error('Failed to play next after skip', error));
    return { skipped, removedUpcoming };
  }

  async stop() {
    const hadSomething = Boolean(this.current) || !this.queue.isEmpty;
    await this.destroy();
    return hadSomething;
  }

  pause() {
    if (this.isPaused) throw new UserError('Playback is already paused.');
    if (!this.player.pause()) throw new UserError('Nothing is playing right now.');
    void this.#refreshNowPlaying(true);
  }

  resume() {
    if (!this.isPaused) throw new UserError('Playback is not paused.');
    if (!this.player.unpause()) throw new UserError('Could not resume playback.');
    void this.#refreshNowPlaying(true);
  }

  /**
   * @param {number} seconds
   */
  async seek(seconds) {
    if (!this.current) throw new UserError('Nothing is playing right now.');
    if (this.current.isLive) throw new UserError('Live streams cannot be seeked.');
    if (!Number.isFinite(seconds) || seconds < 0) throw new UserError('That seek position is invalid.');
    if (this.current.durationSec && seconds >= this.current.durationSec) {
      throw new UserError(`That is past the end of the track (${this.current.durationSec}s).`);
    }
    await this.#restartAt(Math.floor(seconds * 1000));
  }

  /**
   * @param {number} level 0-200
   */
  async setVolume(level) {
    const next = Math.max(0, Math.min(200, Math.round(level)));
    if (next === this.volume) return false;
    this.volume = next;
    if (this.current && this.currentFilePath) {
      await this.#restartAt(this.positionMs);
    }
    return true;
  }

  /**
   * @param {number} seekMs
   */
  async #restartAt(seekMs) {
    const track = this.current;
    if (!track || !this.currentFilePath) throw new UserError('Nothing is playing right now.');

    const wasPaused = this.isPaused;
    const generation = ++this.generation;
    const oldCleanup = this.currentCleanup;

    const playback = createPlaybackResource({
      filePath: this.currentFilePath,
      codec: track.codec ?? null,
      seekMs,
      volume: this.volume,
      normalize: this.config.audioNormalize,
      bitrateKbps: this.bitrateKbps,
      ffmpegPath: this.config.ffmpegPath,
      tempDir: this.config.tempDir,
      logger: this.logger,
    });

    this.currentCleanup = playback.cleanup;
    this.seekOffsetMs = Math.max(0, Math.floor(seekMs));
    this.audioMode = playback.copy ? 'Opus passthrough' : `Opus ${this.bitrateKbps}k`;
    try {
      this.player.play(playback.resource);
    } catch (error) {
      playback.cleanup();
      this.currentCleanup = oldCleanup;
      throw error;
    }
    // play() destroys the previous stream; only now is it safe to kill ffmpeg.
    oldCleanup?.();
    if (wasPaused) this.#pauseWhenPlaying();
    this.#watchCompletion(generation, track, playback);
  }

  #pauseWhenPlaying() {
    const onState = (_oldState, newState) => {
      if (newState.status === AudioPlayerStatus.Playing) {
        this.player.pause();
        this.player.off('stateChange', onState);
      } else if (newState.status === AudioPlayerStatus.Idle) {
        this.player.off('stateChange', onState);
      }
    };
    this.player.on('stateChange', onState);
  }

  /** @param {string} mode */
  setLoop(mode) {
    if (!['off', 'track', 'queue'].includes(mode)) {
      throw new UserError('Loop mode must be off, track, or queue.');
    }
    this.loopMode = mode;
  }

  /**
   * Replay the most recently finished track, or restart the current track when
   * there is no history.
   *
   * @returns {Promise<{ restarted: boolean, track: import('./youtube.js').Track | null }>}
   */
  async previous() {
    if (this.destroyed) throw new UserError('This player is closed.');
    const prev = this.history.shift();
    if (!prev) {
      if (!this.current) throw new UserError('Nothing is playing right now.');
      await this.seek(0);
      return { restarted: true, track: this.current };
    }
    try {
      this.queue.addNext({ ...prev });
    } catch (error) {
      this.history.unshift(prev);
      throw error;
    }
    this.skip(1);
    return { restarted: false, track: prev };
  }

  /** @param {number} position 1-based */
  jump(position) {
    if (position < 1 || position > this.queue.length) {
      throw new UserError(`Queue position must be between 1 and ${Math.max(1, this.queue.length)}.`);
    }
    const removed = this.queue.skip(position - 1);
    this.skip(1);
    return removed;
  }

  /**
   * @param {import('discord.js').GuildMember | import('discord.js').APIInteractionGuildMember | null} member
   * @param {Readonly<import('discord.js').PermissionsBitField> | null} [permissions]
   */
  isDJ(member, permissions = null) {
    if (this.config.djRoleIds.length === 0) return true;
    if (permissions?.has?.(PermissionFlagsBits.ManageGuild)) return true;

    const roles = member?.roles;
    let roleIds = [];
    if (Array.isArray(roles)) {
      roleIds = roles;
    } else if (roles?.cache) {
      roleIds = [...roles.cache.keys()];
    }
    return this.config.djRoleIds.some((roleId) => roleIds.includes(roleId));
  }

  /**
   * Play the configured join clip on a fresh connection. Fire-and-forget so
   * /play is not delayed by the clip.
   */
  async playJoinSound() {
    if (!this.config.joinSoundFile || this.destroyed || this.closing) return;
    await this.#playSound(this.config.joinSoundFile);
  }

  /**
   * Play a short clip by temporarily taking over the voice connection. The
   * music player uses NoSubscriberBehavior.Pause, so it pauses while the clip
   * plays and resumes when it is re-subscribed.
   *
   * @param {string} filePath
   * @param {{ allowClosing?: boolean }} [options]
   */
  async #playSound(filePath, options = {}) {
    if (!filePath || this.playingSound) return false;
    if ((this.destroyed || this.closing) && !options.allowClosing) return false;

    const connection = this.connection;
    if (!connection || connection.state.status === VoiceConnectionStatus.Destroyed) return false;

    const maxMs = Math.max(0, (this.config.soundMaxSeconds ?? 0) * 1000);
    if (maxMs === 0) return false;

    this.playingSound = true;
    const soundPlayer = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
    soundPlayer.on('error', (error) => this.logger.debug('Sound clip player error', error));
    let playback = null;

    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 5_000).catch(() => {});
      if (connection.state.status !== VoiceConnectionStatus.Ready) return false;

      playback = createPlaybackResource({
        filePath,
        codec: null,
        seekMs: 0,
        volume: this.config.soundVolume,
        normalize: false,
        bitrateKbps: this.bitrateKbps,
        ffmpegPath: this.config.ffmpegPath,
        tempDir: this.config.tempDir,
        logger: this.logger,
      });

      // Subscribing swaps the connection to the sound player; the music player
      // pauses automatically because it has no subscriber.
      connection.subscribe(soundPlayer);
      soundPlayer.play(playback.resource);

      const finished = new Promise((resolve) => {
        soundPlayer.once(AudioPlayerStatus.Idle, resolve);
        soundPlayer.once('error', resolve);
        playback.completion.then(resolve, resolve);
      });
      await Promise.race([
        finished,
        new Promise((resolve) => {
          const timer = setTimeout(resolve, maxMs);
          timer.unref?.();
        }),
      ]);
      return true;
    } catch (error) {
      this.logger.warn('Could not play the sound clip', error);
      return false;
    } finally {
      this.playingSound = false;
      try {
        soundPlayer.stop(true);
      } catch {
        // Already idle.
      }
      playback?.cleanup();
      if (
        !this.destroyed &&
        this.connection &&
        this.connection.state.status !== VoiceConnectionStatus.Destroyed
      ) {
        try {
          this.connection.subscribe(this.player);
        } catch (error) {
          this.logger.debug('Could not restore the music player subscription', error);
        }
      }
    }
  }

  /** @param {any} error */
  #isUnknownMessage(error) {
    return error?.code === 10008 || error?.status === 404 || error?.statusCode === 404;
  }

  /**
   * Adopt a manually requested `/nowplaying` reply as the live card. The
   * previous card (and its queue card) is removed, this message takes over the
   * progress refresh, and the next track cleans it up like an automatic card.
   *
   * @param {import('discord.js').Message} message
   * @param {string} trackId
   * @returns {Promise<boolean>} false when the track changed or the player closed
   */
  async adoptNowPlayingMessage(message, trackId) {
    if (this.destroyed || !message) return false;

    if (!this.current || this.current.id !== trackId) {
      await message.delete().catch(() => {});
      return false;
    }

    if (this.nowPlayingMessage?.id === message.id) {
      this.#startNowPlayingTimer();
      return true;
    }

    await this.#removeNowPlaying();

    if (this.destroyed || !this.current || this.current.id !== trackId) {
      await message.delete().catch(() => {});
      return false;
    }

    // Invalidate sends and edits that were still using the previous card.
    this.nowPlayingGeneration++;
    this.nowPlayingMessage = message;
    this.#startNowPlayingTimer();
    await this.#updateQueueBoard();
    return true;
  }

  async #sendNowPlaying() {
    if (!this.current || !this.textChannel?.isTextBased()) return;

    if (!this.config.nowPlayingMessages) {
      // A manually requested card must not outlive its track just because
      // automatic cards are disabled.
      if (this.nowPlayingMessage) await this.#removeNowPlaying();
      return;
    }

    const track = this.current;
    const generation = ++this.nowPlayingGeneration;

    // A new track always gets a fresh card at the bottom of the channel so it
    // is visible without scrolling. The old pair is removed first, and the
    // queue card is re-sent directly below the new now-playing card.
    await this.#removeNowPlaying();
    if (generation !== this.nowPlayingGeneration || this.current !== track) return;

    let sent;
    try {
      sent = await this.textChannel.send({
        embeds: [nowPlayingEmbed(this.config, this)],
        components: nowPlayingButtons(this.guild.id, this.isPaused, track.id),
      });
    } catch (error) {
      this.logger.warn('Could not send the now-playing message', error);
      return;
    }

    if (generation !== this.nowPlayingGeneration || this.current !== track || this.destroyed) {
      // A newer track (or a shutdown) superseded this one while the send was
      // in flight.
      await sent.delete().catch(() => {});
      return;
    }

    this.nowPlayingMessage = sent;
    this.#startNowPlayingTimer();
    await this.#updateQueueBoard();
  }

  #startNowPlayingTimer() {
    this.#clearNowPlayingTimer();
    this.nowPlayingTimer = setInterval(() => {
      void this.#refreshNowPlaying();
    }, 12_000);
    this.nowPlayingTimer.unref?.();
  }

  #clearNowPlayingTimer() {
    if (this.nowPlayingTimer) {
      clearInterval(this.nowPlayingTimer);
      this.nowPlayingTimer = null;
    }
  }

  async #refreshNowPlaying(force = false) {
    if (this.destroyed || !this.current || !this.nowPlayingMessage) return;
    if (!force && this.isPaused) return;
    const track = this.current;
    const message = this.nowPlayingMessage;
    try {
      await message.edit({
        embeds: [nowPlayingEmbed(this.config, this)],
        components: nowPlayingButtons(this.guild.id, this.isPaused, track.id),
      });
      // A removal may have run while this edit was in flight. Do not leave
      // buttons on a finished track.
      if (this.nowPlayingMessage !== message) {
        await message.edit({ components: [] }).catch(() => {});
      }
    } catch (error) {
      if (this.#isUnknownMessage(error)) {
        // Only forget the message if a newer one has not replaced it.
        if (this.nowPlayingMessage === message) {
          this.nowPlayingMessage = null;
          this.#clearNowPlayingTimer();
        }
      } else {
        this.logger.debug('Could not refresh the now-playing message', error);
      }
    }
  }

  /** Delete the now-playing and queue cards and stop refreshing them. */
  async #removeNowPlaying() {
    this.#clearNowPlayingTimer();
    const message = this.nowPlayingMessage;
    this.nowPlayingMessage = null;
    await this.#removeQueueBoard();
    if (!message) return;
    try {
      await message.delete();
    } catch (error) {
      // The user may have deleted it already.
      if (this.#isUnknownMessage(error)) return;
      this.logger.debug('Could not delete the now-playing message', error);
      // If deleting is not permitted, at least remove the controls.
      await message.edit({ components: [] }).catch(() => {});
    }
  }

  #scheduleQueueBoardUpdate() {
    if (this.destroyed || !this.config.nowPlayingMessages) return;
    if (this.queueBoardTimer) clearTimeout(this.queueBoardTimer);
    this.queueBoardTimer = setTimeout(() => {
      this.queueBoardTimer = null;
      void this.#updateQueueBoard();
      // While playing, the 12 s tick refreshes the now-playing preview; while
      // paused that tick is skipped, so keep it current here.
      if (this.isPaused) void this.#refreshNowPlaying(true);
    }, 250);
    this.queueBoardTimer.unref?.();
  }

  async #updateQueueBoard() {
    if (this.destroyed || !this.config.nowPlayingMessages) return;
    if (!this.nowPlayingMessage || !this.textChannel?.isTextBased()) return;

    const generation = this.nowPlayingGeneration;
    const tracks = this.queue.toArray();
    if (tracks.length === 0) {
      if (generation === this.nowPlayingGeneration) await this.#removeQueueBoard();
      return;
    }

    const signature = `${tracks.length}:${tracks
      .slice(0, QUEUE_PREVIEW_LIMIT)
      .map((track) => track.id)
      .join(',')}`;
    if (this.queueMessage && signature === this.queueBoardSignature) return;

    const currentRemainingSec =
      this.current?.durationSec !== null && this.current?.durationSec !== undefined
        ? Math.max(0, this.current.durationSec - Math.floor(this.positionMs / 1000))
        : 0;
    const embed = queueBoardEmbed(this.config, tracks, { currentRemainingSec });
    try {
      if (this.queueMessage) {
        await this.queueMessage.edit({ embeds: [embed] });
        if (generation !== this.nowPlayingGeneration) return;
      } else {
        const sent = await this.textChannel.send({ embeds: [embed] });
        // A track change may have deleted the cards while this send was in
        // flight. Do not leave an orphan above the new now-playing card.
        if (generation !== this.nowPlayingGeneration || this.destroyed) {
          await sent.delete().catch(() => {});
          return;
        }
        this.queueMessage = sent;
      }
      this.queueBoardSignature = signature;
    } catch (error) {
      if (this.#isUnknownMessage(error)) {
        this.queueMessage = null;
        this.queueBoardSignature = '';
      } else {
        this.logger.debug('Could not update the queue card', error);
      }
    }
  }

  async #removeQueueBoard() {
    if (this.queueBoardTimer) {
      clearTimeout(this.queueBoardTimer);
      this.queueBoardTimer = null;
    }
    const message = this.queueMessage;
    this.queueMessage = null;
    this.queueBoardSignature = '';
    if (!message) return;
    try {
      await message.delete();
    } catch (error) {
      if (!this.#isUnknownMessage(error)) {
        this.logger.debug('Could not delete the queue card', error);
      }
    }
  }

  /** @param {import('discord.js').EmbedBuilder} embed */
  async #notify(embed) {
    if (!this.textChannel?.isTextBased()) return;
    try {
      await this.textChannel.send({ embeds: [embed] });
    } catch (error) {
      this.logger.warn('Could not send notification', error);
    }
  }

  #scheduleIdleDisconnect() {
    this.#clearIdleTimer();
    if (this.config.idleDisconnectSeconds <= 0) return;

    this.idleTimer = setTimeout(() => {
      if (this.destroyed || this.current || !this.queue.isEmpty) return;
      this.logger.info('Idle timeout reached; leaving voice channel');
      this.#notify(successEmbed(this.config, 'Left the voice channel', 'I was idle for a while, so I left. Use `/play` to bring me back.'))
        .catch(() => {})
        .finally(() => this.destroy().catch(() => {}));
    }, this.config.idleDisconnectSeconds * 1000);
    this.idleTimer.unref?.();
  }

  #clearIdleTimer() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  /**
   * @param {{ silent?: boolean }} [options] `silent` skips the leave clip
   *   (used during process shutdown so exit stays quick).
   */
  destroy(options = {}) {
    if (this.destroyPromise) return this.destroyPromise;
    if (this.destroyed || this.closing) return Promise.resolve();
    this.destroyPromise = this.#doDestroy(options);
    return this.destroyPromise;
  }

  /** @param {{ silent?: boolean }} [options] */
  async #doDestroy(options = {}) {
    this.closing = true;
    this.destroyed = true;
    this.generation++;
    this.abortController?.abort();
    this.abortController = null;
    this.preloadAbort?.abort();
    this.#clearIdleTimer();
    this.#clearAloneTimer();
    this.currentCleanup?.();
    this.currentCleanup = null;
    this.current = null;
    this.currentFilePath = null;
    this.starting = false;
    this.queue.clear();

    try {
      this.player.stop(true);
    } catch {
      // Already idle.
    }

    await this.#removeNowPlaying();

    if (
      !options.silent &&
      this.config.leaveSoundFile &&
      this.connection &&
      this.connection.state.status !== VoiceConnectionStatus.Destroyed
    ) {
      await this.#playSound(this.config.leaveSoundFile, { allowClosing: true });
    }

    await this.#restoreChannelBitrate();

    if (this.connection && this.connection.state.status !== VoiceConnectionStatus.Destroyed) {
      try {
        this.connection.destroy();
      } catch (error) {
        this.logger.warn('Could not destroy voice connection', error);
      }
    }
    this.connection = null;
    this.manager.remove(this.guild.id, this);
    this.logger.info('Player destroyed');
  }
}
