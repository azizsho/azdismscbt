import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { GuildSettingsStore } from '../src/services/guild-settings.js';

test('guild autoplay settings persist and reload', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'guild-settings-'));
  const file = path.join(dir, 'guild-settings.json');

  const store = new GuildSettingsStore(file);
  assert.equal(store.get('guild-1'), null);
  store.setAutoplay('guild-1', true);
  store.setAutoplay('guild-2', false);
  await store.flush();

  const reloaded = new GuildSettingsStore(file);
  await reloaded.load();
  assert.equal(reloaded.get('guild-1')?.autoplay, true);
  assert.equal(reloaded.get('guild-2')?.autoplay, false);
  assert.equal(reloaded.get('guild-3'), null);

  await fs.rm(dir, { recursive: true, force: true });
});

test('guild settings ignore malformed files and values', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'guild-settings-'));
  const file = path.join(dir, 'guild-settings.json');

  await fs.writeFile(file, 'not json', 'utf8');
  const broken = new GuildSettingsStore(file);
  await broken.load();
  assert.equal(broken.get('guild-1'), null);

  await fs.writeFile(
    file,
    JSON.stringify({ version: 1, entries: { 'guild-1': { autoplay: 'yes' }, 'guild-2': null } }),
    'utf8',
  );
  const invalid = new GuildSettingsStore(file);
  await invalid.load();
  assert.equal(invalid.get('guild-1'), null);
  assert.equal(invalid.get('guild-2'), null);

  await fs.rm(dir, { recursive: true, force: true });
});
