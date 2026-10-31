import test from 'node:test';
import assert from 'node:assert/strict';
import { MusicManager } from '../src/music/manager.js';
import { createLogger } from '../src/logger.js';

const config = {
  autoplay: false,
};

function makeManager(settings = null) {
  return new MusicManager({
    config,
    logger: createLogger('silent'),
    cache: {},
    settings,
  });
}

test('autoplay defaults to the config value', () => {
  const manager = makeManager();
  assert.equal(manager.getAutoplay('guild-1'), false);
});

test('autoplay overrides are kept in memory without a settings store', () => {
  const manager = makeManager();
  manager.setAutoplay('guild-1', true);
  assert.equal(manager.getAutoplay('guild-1'), true);
  assert.equal(manager.getAutoplay('guild-2'), false);
});

test('autoplay reads persisted settings and writes new ones', () => {
  const saved = new Map([['guild-1', { autoplay: true }]]);
  const settings = {
    get: (guildId) => saved.get(guildId) ?? null,
    setAutoplay: (guildId, enabled) => saved.set(guildId, { autoplay: enabled }),
  };
  const manager = makeManager(settings);

  assert.equal(manager.getAutoplay('guild-1'), true);
  assert.equal(manager.getAutoplay('guild-2'), false);

  manager.setAutoplay('guild-2', true);
  assert.equal(saved.get('guild-2')?.autoplay, true);
  assert.equal(manager.getAutoplay('guild-2'), true);
});

test('the config value is re-read when no override exists', () => {
  const manager = makeManager();
  manager.config.autoplay = true;
  assert.equal(manager.getAutoplay('guild-3'), true);
});
