import test from 'node:test';
import assert from 'node:assert/strict';
import { isOpusSource } from '../src/music/audio.js';

test('codec probe wins over the extension when available', () => {
  assert.equal(isOpusSource('/cache/a.webm', 'opus'), true);
  assert.equal(isOpusSource('/cache/a.webm', 'vorbis'), false);
  assert.equal(isOpusSource('/cache/a.ogg', 'vorbis'), false);
});

test('unknown WebM is not assumed to be Opus', () => {
  assert.equal(isOpusSource('/cache/a.webm', null), false);
  assert.equal(isOpusSource('/cache/a.m4a', null), false);
});

test('Opus containers fall back to the extension when probing fails', () => {
  assert.equal(isOpusSource('/cache/a.opus', null), true);
  assert.equal(isOpusSource('/cache/a.ogg', null), true);
});
