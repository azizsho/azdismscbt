import test from 'node:test';
import assert from 'node:assert/strict';
import { GuildPlayer } from '../src/music/guild-player.js';
import { createLogger } from '../src/logger.js';

const config = {
  maxQueueSize: 10,
  defaultVolume: 100,
  idleDisconnectSeconds: 0,
  audioNormalize: false,
  maxBitrateKbps: 256,
  autoSetChannelBitrate: false,
  preloadAhead: 0,
  preloadConcurrency: 1,
  ffmpegPath: 'ffmpeg',
  tempDir: 'tmp',
  embedColor: 0,
  nowPlayingMessages: false,
  djRoleIds: [],
  restoreChannelBitrate: true,
  soundVolume: 100,
  soundMaxSeconds: 5,
  pauseWhenAlone: true,
  leaveWhenAloneSeconds: 0,
  autoplay: false,
  autoplayAdd: 5,
};

function makePlayer(overrides = {}) {
  const guild = {
    id: 'guild-1',
    premiumTier: 0,
    members: { me: { id: 'bot-1' } },
    channels: { cache: new Map() },
    voiceAdapterCreator: () => {},
  };
  const voiceChannel = {
    id: 'voice-1',
    bitrate: 96_000,
    permissionsFor: () => null,
    members: new Map(),
  };
  const player = new GuildPlayer({
    guild,
    voiceChannel,
    textChannel: { isTextBased: () => false },
    config: overrides.config ?? config,
    logger: createLogger('silent'),
    cache: {},
    manager: overrides.manager ?? { remove() {} },
  });
  return { player, guild };
}

test('autoplay follows the manager setting with a config fallback', () => {
  const { player } = makePlayer({ manager: { remove() {}, getAutoplay: () => true } });
  assert.equal(player.autoplay, true);

  const { player: configOn } = makePlayer({ config: { ...config, autoplay: true } });
  assert.equal(configOn.autoplay, true);

  const { player: fallback } = makePlayer();
  assert.equal(fallback.autoplay, false);
});

test('destroy is idempotent and concurrent calls share one promise', async () => {
  const { player } = makePlayer();
  const first = player.destroy();
  const second = player.destroy();
  assert.equal(first, second);
  await first;
  assert.equal(player.destroyed, true);
});

test('a bot moved by a moderator updates its cached voice channel', () => {
  const { player, guild } = makePlayer();
  const newChannel = {
    id: 'voice-2',
    bitrate: 96_000,
    permissionsFor: () => null,
    members: new Map(),
  };
  guild.channels.cache.set('voice-2', newChannel);

  player.handleVoiceStateUpdate(
    { id: 'bot-1', channelId: 'voice-1' },
    { id: 'bot-1', channelId: 'voice-2' },
  );

  assert.equal(player.voiceChannelId, 'voice-2');
  assert.equal(player.voiceChannel.id, 'voice-2');
  void player.destroy();
});
