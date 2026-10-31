import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { loadConfig } from '../src/config.js';
import { createLogger } from '../src/logger.js';
import { YouTube } from '../src/music/youtube.js';

const enabled = process.env.RUN_INTEGRATION === '1';

test('live YouTube search and video resolution', { skip: !enabled }, async () => {
  const config = loadConfig(
    {
      ...process.env,
      DISCORD_TOKEN: 'x'.repeat(30),
      DISCORD_CLIENT_ID: '123456789012345678',
      MAX_PLAYLIST_ITEMS: '2',
    },
    { checkTools: true },
  );
  await fs.mkdir(config.tempDir, { recursive: true });
  await fs.mkdir(config.ytdlpCacheDir, { recursive: true });

  const youtube = new YouTube(config, createLogger('warn', 'integration'));
  const results = await youtube.search('lofi hip hop', 3);
  assert.ok(Array.isArray(results));
  assert.ok(results.length >= 1);

  const resolved = await youtube.resolveUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(resolved.kind, 'track');
  assert.equal(resolved.track.id, 'dQw4w9WgXcQ');
  assert.ok(resolved.track.durationSec > 0);
});
