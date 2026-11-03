import test from 'node:test';
import assert from 'node:assert/strict';
import { GuildPlayer } from '../src/music/guild-player.js';
import { createLogger } from '../src/logger.js';

const config = {
  maxQueueSize: 100,
  defaultVolume: 80,
  nowPlayingMessages: true,
  leaveSoundFile: null,
  joinSoundFile: null,
  soundVolume: 100,
  soundMaxSeconds: 5,
  restoreChannelBitrate: true,
  preloadAhead: 0,
  preloadConcurrency: 1,
  idleDisconnectSeconds: 0,
};

function makePlayer() {
  return new GuildPlayer({
    guild: {
      id: 'guild1',
      channels: { cache: new Map() },
      members: { me: null },
      premiumTier: 0,
      voiceAdapterCreator: () => {},
    },
    voiceChannel: { id: 'voice1', bitrate: 64_000, permissionsFor: () => null },
    textChannel: { isTextBased: () => true },
    config,
    logger: createLogger('silent'),
    cache: {},
    manager: { remove() {} },
  });
}

function trackedMessage(deleteImpl) {
  const calls = { deleted: 0, edited: 0 };
  return {
    calls,
    message: {
      id: `msg-${Math.random()}`,
      async delete() {
        calls.deleted++;
        await deleteImpl?.();
      },
      async edit() {
        calls.edited++;
      },
    },
  };
}

test('a manual now-playing card replaces the tracked card and starts refreshing', async () => {
  const player = makePlayer();
  player.current = { id: 'track-1', title: 'Track', durationSec: 60 };
  const previous = trackedMessage();
  const queueCard = trackedMessage();
  player.nowPlayingMessage = previous.message;
  player.queueMessage = queueCard.message;
  const manual = trackedMessage();

  const adopted = await player.adoptNowPlayingMessage(manual.message, 'track-1');

  assert.equal(adopted, true);
  assert.equal(previous.calls.deleted, 1);
  assert.equal(queueCard.calls.deleted, 1);
  assert.equal(player.nowPlayingMessage, manual.message);
  assert.ok(player.nowPlayingTimer);

  await player.destroy();
});

test('a manual now-playing card for a track that already changed is deleted', async () => {
  const player = makePlayer();
  player.current = { id: 'track-2', title: 'Next track', durationSec: 60 };
  const manual = trackedMessage();

  const adopted = await player.adoptNowPlayingMessage(manual.message, 'track-1');

  assert.equal(adopted, false);
  assert.equal(manual.calls.deleted, 1);
  assert.equal(player.nowPlayingMessage, null);
});

test('destroy deletes the tracked now-playing message', async () => {
  const player = makePlayer();
  const { calls, message } = trackedMessage();
  player.nowPlayingMessage = message;

  await player.destroy();

  assert.equal(calls.deleted, 1);
  assert.equal(calls.edited, 0);
});

test('destroy deletes the now-playing and queue cards', async () => {
  const player = makePlayer();
  const nowPlaying = trackedMessage();
  const queue = trackedMessage();
  player.nowPlayingMessage = nowPlaying.message;
  player.queueMessage = queue.message;

  await player.destroy();

  assert.equal(nowPlaying.calls.deleted, 1);
  assert.equal(queue.calls.deleted, 1);
});

test('destroy falls back to removing buttons when delete is not permitted', async () => {
  const player = makePlayer();
  const { calls, message } = trackedMessage(() => {
    throw Object.assign(new Error('Missing Permissions'), { code: 50013 });
  });
  player.nowPlayingMessage = message;

  await player.destroy();

  assert.equal(calls.deleted, 1);
  assert.equal(calls.edited, 1);
});

test('destroy ignores a now-playing message the user already deleted', async () => {
  const player = makePlayer();
  const { calls, message } = trackedMessage(() => {
    throw Object.assign(new Error('Unknown Message'), { code: 10008 });
  });
  player.nowPlayingMessage = message;

  await player.destroy();

  assert.equal(calls.deleted, 1);
  assert.equal(calls.edited, 0);
});
