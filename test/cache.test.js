import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MediaCache } from '../src/music/cache.js';
import { createLogger } from '../src/logger.js';

function fakeTrack(id) {
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

test('cache downloads once, reuses the file, and prunes unprotected files', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'music-cache-'));
  let downloads = 0;
  const youtube = {
    async download(track) {
      downloads++;
      const file = path.join(dir, `${track.id}.webm`);
      await fs.writeFile(file, Buffer.alloc(4096, 1));
      return file;
    },
  };

  const cache = new MediaCache({
    dir,
    maxBytes: 10_000,
    youtube,
    logger: createLogger('silent'),
    isProtected: (id) => id === 'protected1',
  });
  await cache.init();

  const first = await cache.ensure(fakeTrack('aaaaaaaaaaa'));
  const second = await cache.ensure(fakeTrack('aaaaaaaaaaa'));
  assert.equal(first, second);
  assert.equal(downloads, 1);
  assert.equal(cache.getStats().count, 1);

  await cache.ensure(fakeTrack('protected1'));
  await cache.ensure(fakeTrack('protected2'));
  // 3 files × 4 KiB > 10 KiB; one unprotected file should be evicted while the
  // protected file is retained.
  await cache.prune();
  assert.equal(cache.getStats().count, 2);
  assert.equal(await fs.stat(path.join(dir, 'protected1.webm')).then(() => true).catch(() => false), true);

  await cache.clear();
  assert.equal(cache.getStats().count, 0);
  await fs.rm(dir, { recursive: true, force: true });
});

test('cache ignores aborted downloads', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'music-cache-'));
  const youtube = {
    async download() {
      throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
    },
  };
  const cache = new MediaCache({
    dir,
    maxBytes: 10_000,
    youtube,
    logger: createLogger('silent'),
  });
  await cache.init();
  await assert.rejects(() => cache.ensure(fakeTrack('bbbbbbbbbbb')), /Aborted/);
  assert.equal(cache.getStats().count, 0);
  await fs.rm(dir, { recursive: true, force: true });
});

test('concurrent prune calls share one pass and keep byte accounting exact', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'music-cache-'));
  const youtube = {
    async download(track) {
      const file = path.join(dir, `${track.id}.webm`);
      await fs.writeFile(file, Buffer.alloc(4096, 1));
      return file;
    },
  };

  const cache = new MediaCache({
    dir,
    maxBytes: 1_000_000,
    youtube,
    logger: createLogger('silent'),
  });
  await cache.init();

  for (const id of ['ccccccccccc', 'ddddddddddd', 'eeeeeeeeeee', 'fffffffffff']) {
    await cache.ensure(fakeTrack(id));
  }
  assert.equal(cache.getStats().count, 4);
  assert.equal(cache.getStats().totalBytes, 4 * 4096);

  // Lower the cap after the downloads so the best-effort prune in ensure() has
  // not already evicted anything.
  cache.maxBytes = 8_000;

  // Three overlapping prunes must not delete the same entry twice or subtract
  // its size more than once.
  await Promise.all([cache.prune(), cache.prune(), cache.prune()]);

  const stats = cache.getStats();
  let actualBytes = 0;
  for (const file of await fs.readdir(dir)) {
    if (file === 'index.json') continue;
    actualBytes += (await fs.stat(path.join(dir, file))).size;
  }
  assert.equal(stats.totalBytes, actualBytes);
  assert.ok(stats.totalBytes <= 8_000);
  assert.ok(stats.count >= 1);

  await fs.rm(dir, { recursive: true, force: true });
});

test('one caller aborting does not cancel a shared download', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'music-cache-'));
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const youtube = {
    async download(track) {
      await gate;
      const file = path.join(dir, `${track.id}.webm`);
      await fs.writeFile(file, Buffer.alloc(4096, 1));
      return file;
    },
  };
  const cache = new MediaCache({
    dir,
    maxBytes: 1_000_000,
    youtube,
    logger: createLogger('silent'),
  });
  await cache.init({ prune: false });

  const controller = new AbortController();
  const first = cache.ensure(fakeTrack('aaaaaaaaaaa'), { signal: controller.signal });
  const second = cache.ensure(fakeTrack('aaaaaaaaaaa'));
  controller.abort();

  await assert.rejects(() => first, /Aborted/);
  release();
  const resolved = await second;
  assert.ok(resolved.endsWith('aaaaaaaaaaa.webm'));
  assert.equal(cache.has('aaaaaaaaaaa'), true);

  await fs.rm(dir, { recursive: true, force: true });
});

test('init sweeps partial files and stale PyInstaller temp bundles', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'music-cache-'));
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'music-tmp-'));
  await fs.writeFile(path.join(dir, 'bbbbbbbbbbb.webm.part'), 'partial');
  await fs.writeFile(path.join(dir, 'ccccccccccc.webm'), Buffer.alloc(4096, 1));
  await fs.mkdir(path.join(tempDir, '_MEI12345'));

  const cache = new MediaCache({
    dir,
    tempDir,
    maxBytes: 1_000_000,
    youtube: { download: async () => { throw new Error('not used'); } },
    logger: createLogger('silent'),
  });
  await cache.init({ prune: false });

  assert.equal(await fs.access(path.join(dir, 'bbbbbbbbbbb.webm.part')).then(() => true).catch(() => false), false);
  assert.equal(await fs.access(path.join(tempDir, '_MEI12345')).then(() => true).catch(() => false), false);
  assert.equal(cache.has('ccccccccccc'), true);

  await fs.rm(dir, { recursive: true, force: true });
  await fs.rm(tempDir, { recursive: true, force: true });
});
