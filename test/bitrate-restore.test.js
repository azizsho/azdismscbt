import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BitrateRestoreStore } from '../src/services/bitrate-restore.js';

test('bitrate restore records persist, reload, and clear', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bitrate-restore-'));
  const file = path.join(dir, 'bitrate-restore.json');

  const store = new BitrateRestoreStore(file);
  store.save('guild-1', 'channel-1', 64_000, 256_000);
  await store.flush();

  const reloaded = new BitrateRestoreStore(file);
  await reloaded.load();
  const list = reloaded.list();
  assert.equal(list.length, 1);
  assert.equal(list[0][0], 'guild-1:channel-1');
  assert.equal(list[0][1].originalBitrate, 64_000);
  assert.equal(list[0][1].appliedBitrate, 256_000);

  reloaded.clear('guild-1', 'channel-1');
  await reloaded.flush();

  const empty = new BitrateRestoreStore(file);
  await empty.load();
  assert.deepEqual(empty.list(), []);

  await fs.rm(dir, { recursive: true, force: true });
});
