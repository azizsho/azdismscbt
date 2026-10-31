import test from 'node:test';
import assert from 'node:assert/strict';
import { GuildPlayer } from '../src/music/guild-player.js';

function track(id) {
  return {
    id,
    title: `Track ${id}`,
    url: `https://www.youtube.com/watch?v=${id}`,
    durationSec: 60,
    thumbnail: null,
    channel: 'Test',
    isLive: false,
    source: 'youtube',
    codec: null,
    seekOffsetMs: 0,
  };
}

test('queue preloading downloads only PRELOAD_AHEAD tracks, next first', async () => {
  const downloaded = [];
  const cached = new Set();
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const cache = {
    has: (id) => cached.has(id),
    ensure: async (item) => {
      downloaded.push(item.id);
      await gate;
      cached.add(item.id);
      return `/cache/${item.id}.webm`;
    },
  };

  const player = new GuildPlayer({
    guild: {
      id: 'guild-1',
      premiumTier: 0,
      members: { me: { id: 'bot-1' } },
      channels: { cache: new Map() },
      voiceAdapterCreator: () => {},
    },
    voiceChannel: {
      id: 'voice-1',
      bitrate: 96000,
      permissionsFor: () => ({ has: () => false }),
      members: new Map(),
    },
    textChannel: { isTextBased: () => false },
    config: {
      maxQueueSize: 10,
      defaultVolume: 80,
      idleDisconnectSeconds: 0,
      audioNormalize: false,
      maxBitrateKbps: 256,
      autoSetChannelBitrate: false,
      preloadAhead: 3,
      preloadConcurrency: 1,
      ffmpegPath: 'ffmpeg',
      tempDir: 'tmp',
      embedColor: 0,
      nowPlayingMessages: false,
      djRoleIds: [],
    },
    logger: {
      child: () => ({
        debug() {},
        info() {},
        warn() {},
        error() {},
      }),
    },
    cache,
    manager: { remove() {} },
  });

  // Pretend a track is currently playing so enqueue() does not try to connect.
  player.current = track('current0001');
  player.enqueue(track('aaaaaaaaaaa'));
  player.enqueue(track('bbbbbbbbbbb'));
  player.enqueue(track('ccccccccccc'));
  player.enqueue(track('ddddddddddd'));

  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.deepEqual(downloaded, ['aaaaaaaaaaa']); // first worker waits at the gate

  release();
  await new Promise((resolve) => setTimeout(resolve, 75));
  assert.deepEqual(downloaded, ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc']);

  await player.destroy();
});
