import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

const baseEnv = {
  DISCORD_TOKEN: 'x'.repeat(30),
  DISCORD_CLIENT_ID: '123456789012345678',
  DISCORD_GUILD_ID: '',
  DJ_ROLE_IDS: '',
  ALLOWED_TEXT_CHANNEL_IDS: '',
};

test('loadConfig applies defaults', () => {
  const config = loadConfig({ ...baseEnv }, { checkTools: false });
  assert.equal(config.defaultVolume, 80);
  assert.equal(config.maxQueueSize, 100);
  assert.equal(config.maxTrackSeconds, 7200);
  assert.equal(config.maxBitrateKbps, 256);
  assert.equal(config.preloadAhead, 3);
  assert.equal(config.preloadConcurrency, 2);
  assert.equal(config.ytdlpConcurrency, 4);
  assert.equal(config.commandCooldownSeconds, 2);
  assert.equal(config.ytdlpMaxAgeDays, 45);
  assert.equal(config.restoreChannelBitrate, true);
  assert.equal(config.joinSoundFile, null);
  assert.equal(config.leaveSoundFile, null);
  assert.equal(config.soundVolume, 100);
  assert.equal(config.soundMaxSeconds, 5);
  assert.equal(config.guildId, null);
  assert.deepEqual(config.djRoleIds, []);
  assert.match(config.ffmpegPath, /ffmpeg/);
  assert.match(config.ytdlpPath, /yt-dlp/);
});

test('loadConfig parses lists and numbers', () => {
  const config = loadConfig(
    {
      ...baseEnv,
      DISCORD_GUILD_ID: '987654321098765432',
      DJ_ROLE_IDS: '111111111111111111,222222222222222222',
      ALLOWED_TEXT_CHANNEL_IDS: '333333333333333333',
      DEFAULT_VOLUME: '55',
      MAX_TRACK_MINUTES: '10',
      AUTO_SET_CHANNEL_BITRATE: 'false',
    },
    { checkTools: false },
  );
  assert.equal(config.guildId, '987654321098765432');
  assert.deepEqual(config.djRoleIds, ['111111111111111111', '222222222222222222']);
  assert.deepEqual(config.allowedTextChannelIds, ['333333333333333333']);
  assert.equal(config.defaultVolume, 55);
  assert.equal(config.maxTrackSeconds, 600);
  assert.equal(config.autoSetChannelBitrate, false);
});

test('loadConfig rejects invalid values', () => {
  assert.throws(() => loadConfig({ ...baseEnv, DISCORD_CLIENT_ID: 'nope' }, { checkTools: false }), /DISCORD_CLIENT_ID/);
  assert.throws(() => loadConfig({ ...baseEnv, DEFAULT_VOLUME: '900' }, { checkTools: false }), /DEFAULT_VOLUME/);
  assert.throws(() => loadConfig({ ...baseEnv, DISCORD_GUILD_ID: 'bad' }, { checkTools: false }), /DISCORD_GUILD_ID/);
});
