import test from 'node:test';
import assert from 'node:assert/strict';
import { ChannelType } from 'discord.js';
import play from '../src/commands/play.js';
import search from '../src/commands/search.js';
import skip from '../src/commands/skip.js';
import volume from '../src/commands/volume.js';
import autoplay from '../src/commands/autoplay.js';
import nowplaying from '../src/commands/nowplaying.js';
import { loadConfig } from '../src/config.js';

const config = loadConfig(
  {
    DISCORD_TOKEN: 'x'.repeat(30),
    DISCORD_CLIENT_ID: '123456789012345678',
  },
  { checkTools: false },
);

function makeTrack(id = 'dQw4w9WgXcQ') {
  return {
    id,
    title: 'Test Song',
    url: `https://www.youtube.com/watch?v=${id}`,
    durationSec: 213,
    thumbnail: null,
    channel: 'Test Channel',
    isLive: false,
    source: 'youtube',
    codec: null,
    seekOffsetMs: 0,
  };
}

function fakePlayer(overrides = {}) {
  const queue = {
    length: 0,
    isEmpty: true,
    toArray: () => [],
    ...overrides.queue,
  };
  return {
    current: null,
    voiceChannelId: 'voice-channel',
    queue,
    isPaused: false,
    loopMode: 'off',
    volume: 80,
    setTextChannel() {},
    async enqueue(track, options = {}) {
      this.current = track;
      this.queue.length += 1;
      this.queue.isEmpty = false;
      this.lastEnqueue = { track, options };
      return this.queue.length;
    },
    isDJ: () => true,
    skip(count = 1) {
      this.lastSkip = count;
      return { skipped: makeTrack(), removedUpcoming: 0 };
    },
    async setVolume(level) {
      this.volume = level;
      return true;
    },
    ...overrides,
  };
}

function makeInteraction({ options = {}, member, voice = true } = {}) {
  const replies = [];
  const channel = {
    id: 'text-channel',
    type: ChannelType.GuildText,
    isTextBased: () => true,
    send: async () => {},
    permissionsFor: () => ({ has: () => true }),
  };
  const voiceChannel = {
    id: 'voice-channel',
    type: ChannelType.GuildVoice,
    bitrate: 256000,
    permissionsFor: () => ({ has: () => true }),
    members: new Map(),
  };
  const memberObject = member ?? {
    id: 'user-1',
    displayName: 'Tester',
    roles: { cache: new Map() },
    permissions: { has: () => true },
    voice: { channel: voice ? voiceChannel : null },
  };

  return {
    guildId: '123456789012345678',
    guild: {
      id: '123456789012345678',
      members: { me: { id: 'bot-1' } },
    },
    channel,
    user: { id: 'user-1', username: 'tester', globalName: 'Tester' },
    member: memberObject,
    memberPermissions: { has: () => true },
    deferred: false,
    replied: false,
    options: {
      getString: (name) => options[name] ?? null,
      getBoolean: (name) => options[name] ?? null,
      getInteger: (name) => options[name] ?? null,
    },
    async deferReply() {
      this.deferred = true;
    },
    async editReply(payload) {
      this.replied = true;
      replies.push(payload);
    },
    async reply(payload) {
      this.replied = true;
      replies.push({ ...payload, ephemeralReply: true });
      return this.replyMessage;
    },
    replies,
    voiceChannel,
  };
}

test('/play searches and enqueues the first result', async () => {
  const interaction = makeInteraction({ options: { query: 'test song', next: false, playlist: false } });
  const player = fakePlayer();
  const ctx = {
    config,
    music: { getOrCreate: async () => player },
    youtube: { search: async () => [makeTrack()] },
  };

  await play.execute(interaction, ctx);
  assert.equal(interaction.deferred, true);
  assert.equal(player.lastEnqueue.track.id, 'dQw4w9WgXcQ');
  assert.equal(interaction.replies.length, 2);
  assert.equal(interaction.replies[0].content, 'Searching YouTube…');
  assert.equal(interaction.replies.at(-1).embeds[0].data.title, 'Added to queue');
});

test('/play rejects a non-YouTube URL', async () => {
  const interaction = makeInteraction({ options: { query: 'https://example.com/song' } });
  await assert.rejects(() => play.execute(interaction, {}), /Only YouTube links/);
});

test('/search returns a select menu', async () => {
  const interaction = makeInteraction({ options: { query: 'test song' } });
  const ctx = {
    config,
    youtube: { search: async () => [makeTrack(), makeTrack('abcdefghijk')] },
  };

  await search.execute(interaction, ctx);
  assert.equal(interaction.deferred, true);
  assert.equal(interaction.replies.length, 2);
  assert.equal(interaction.replies[0].content, 'Searching YouTube…');
  const reply = interaction.replies.at(-1);
  const embed = reply.embeds[0];
  assert.doesNotMatch(embed.data.description, /\]\(/);
  assert.match(embed.data.footer.text, /dropdown below/i);
  const components = reply.components;
  assert.equal(components.length, 2);
  const row = components[0].toJSON();
  assert.equal(row.components[0].type, 3); // String select
  const cancelRow = components[1].toJSON();
  assert.equal(cancelRow.components[0].type, 2); // Button
  assert.match(cancelRow.components[0].custom_id, /^search:cancel:/);
});

test('/skip skips immediately without a vote', async () => {
  const interaction = makeInteraction();
  const player = fakePlayer({
    current: makeTrack(),
    isDJ: () => false,
    skip: () => ({ skipped: makeTrack(), removedUpcoming: 0 }),
    queue: { length: 1, isEmpty: false, toArray: () => [makeTrack()] },
  });
  const ctx = { config, music: { get: () => player } };

  await skip.execute(interaction, ctx);
  assert.equal(interaction.replies.length, 1);
  assert.match(interaction.replies[0].embeds[0].data.description, /Skipped/);
});

test('/skip lets anyone skip multiple tracks', async () => {
  const interaction = makeInteraction({ options: { count: 5 } });
  const player = fakePlayer({
    current: makeTrack(),
    isDJ: () => false,
    skip(count) {
      this.lastSkip = count;
      return { skipped: makeTrack(), removedUpcoming: 4 };
    },
    queue: { length: 3, isEmpty: false, toArray: () => [makeTrack()] },
  });
  const ctx = { config, music: { get: () => player } };

  await skip.execute(interaction, ctx);
  assert.equal(player.lastSkip, 5);
  assert.match(interaction.replies[0].embeds[0].data.description, /4 upcoming/);
});

test('/volume clamps through the player and reports the new value', async () => {
  const interaction = makeInteraction({ options: { level: 150 } });
  const player = fakePlayer();
  const ctx = { config, music: { get: () => player } };

  await volume.execute(interaction, ctx);
  assert.equal(player.volume, 150);
  assert.equal(interaction.replies.length, 1);
});

test('/autoplay toggles the server setting', async () => {
  const interaction = makeInteraction();
  const state = { enabled: false };
  const ctx = {
    config,
    music: {
      getAutoplay: () => state.enabled,
      setAutoplay: (guildId, enabled) => {
        state.enabled = enabled;
        state.guildId = guildId;
      },
    },
  };

  await autoplay.execute(interaction, ctx);
  assert.equal(state.enabled, true);
  assert.equal(state.guildId, interaction.guildId);
  assert.match(interaction.replies[0].embeds[0].data.description, /now \*\*on\*\*/);
});

test('/autoplay accepts an explicit value', async () => {
  const interaction = makeInteraction({ options: { enabled: false } });
  const state = { enabled: true };
  const ctx = {
    config,
    music: {
      getAutoplay: () => state.enabled,
      setAutoplay: (_guildId, enabled) => {
        state.enabled = enabled;
      },
    },
  };

  await autoplay.execute(interaction, ctx);
  assert.equal(state.enabled, false);
  assert.match(interaction.replies[0].embeds[0].data.description, /now \*\*off\*\*/);
});

test('/nowplaying adopts its reply as the live card', async () => {
  const interaction = makeInteraction();
  interaction.replyMessage = { id: 'manual-card' };
  const player = fakePlayer({
    current: makeTrack(),
    async adoptNowPlayingMessage(message, trackId) {
      this.adopted = { message, trackId };
      return true;
    },
  });
  const ctx = { config, music: { get: () => player } };

  await nowplaying.execute(interaction, ctx);

  assert.equal(player.adopted.message, interaction.replyMessage);
  assert.equal(player.adopted.trackId, 'dQw4w9WgXcQ');
  assert.equal(interaction.replies[0].embeds[0].data.title, 'Test Song');
});
