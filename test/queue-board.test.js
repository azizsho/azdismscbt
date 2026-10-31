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
  embedColor: 0x5865f2,
};

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
  };
}

function makePlayer() {
  const sent = [];
  const textChannel = {
    isTextBased: () => true,
    async send(payload) {
      const message = {
        payload,
        deleted: false,
        async delete() {
          this.deleted = true;
        },
        async edit(next) {
          this.payload = next;
        },
      };
      sent.push(message);
      return message;
    },
  };

  const player = new GuildPlayer({
    guild: {
      id: 'guild1',
      channels: { cache: new Map() },
      members: { me: null },
      premiumTier: 0,
      voiceAdapterCreator: () => {},
    },
    voiceChannel: { id: 'voice1', bitrate: 64_000, permissionsFor: () => null },
    textChannel,
    config,
    logger: createLogger('silent'),
    cache: {},
    manager: { remove() {} },
  });

  return { player, sent };
}

test('a queue change posts a queue card below the now-playing card', async () => {
  const { player, sent } = makePlayer();
  player.nowPlayingMessage = {
    async delete() {},
    async edit() {},
  };

  player.queue.add(track('aaaa'));
  await new Promise((resolve) => setTimeout(resolve, 350));

  assert.equal(sent.length, 1);
  const embed = sent[0].payload.embeds[0].toJSON();
  assert.equal(embed.title, 'Queue');
  assert.match(embed.description, /Track aaaa/);
  assert.match(embed.footer.text, /1 track\(s\)/);

  await player.destroy();
  assert.equal(sent[0].deleted, true);
});
