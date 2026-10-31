import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalizeYouTubeUrl,
  extractPlaylistId,
  extractVideoId,
  isPlaylistUrl,
  isYouTubeUrl,
  normalizeYouTubeInput,
  sanitizeQuery,
} from '../src/util/url.js';

const ID = 'dQw4w9WgXcQ';
const LIST = 'PL1234567890';

test('isYouTubeUrl accepts common YouTube hosts', () => {
  assert.equal(isYouTubeUrl(`https://www.youtube.com/watch?v=${ID}`), true);
  assert.equal(isYouTubeUrl(`https://youtu.be/${ID}`), true);
  assert.equal(isYouTubeUrl(`https://music.youtube.com/watch?v=${ID}`), true);
  assert.equal(isYouTubeUrl(`https://m.youtube.com/watch?v=${ID}`), true);
  assert.equal(isYouTubeUrl('https://example.com/watch?v=dQw4w9WgXcQ'), false);
  assert.equal(isYouTubeUrl('not a url'), false);
  assert.equal(isYouTubeUrl('https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ'), false);
});

test('extractVideoId handles watch, short, shorts, and embed URLs', () => {
  assert.equal(extractVideoId(`https://www.youtube.com/watch?v=${ID}`), ID);
  assert.equal(extractVideoId(`https://youtu.be/${ID}?t=10`), ID);
  assert.equal(extractVideoId(`https://www.youtube.com/shorts/${ID}`), ID);
  assert.equal(extractVideoId(`https://www.youtube.com/embed/${ID}`), ID);
  assert.equal(extractVideoId('https://www.youtube.com/watch?v=short'), null);
});

test('playlist URLs are recognized', () => {
  assert.equal(extractPlaylistId(`https://www.youtube.com/playlist?list=${LIST}`), LIST);
  assert.equal(isPlaylistUrl(`https://www.youtube.com/playlist?list=${LIST}`), true);
  assert.equal(isPlaylistUrl(`https://www.youtube.com/watch?v=${ID}&list=${LIST}`), true);
  assert.equal(isPlaylistUrl(`https://www.youtube.com/watch?v=${ID}`), false);
});

test('canonicalizeYouTubeUrl drops tracking parameters', () => {
  assert.equal(
    canonicalizeYouTubeUrl(`https://youtu.be/${ID}?si=tracking&t=30`),
    `https://www.youtube.com/watch?v=${ID}`,
  );
  assert.equal(
    canonicalizeYouTubeUrl(`https://www.youtube.com/watch?v=${ID}&list=${LIST}`),
    `https://www.youtube.com/watch?v=${ID}`,
  );
});

test('scheme-less YouTube URLs are normalized', () => {
  assert.equal(normalizeYouTubeInput('youtu.be/dQw4w9WgXcQ'), 'https://youtu.be/dQw4w9WgXcQ');
  assert.equal(
    normalizeYouTubeInput('music.youtube.com/watch?v=dQw4w9WgXcQ'),
    'https://music.youtube.com/watch?v=dQw4w9WgXcQ',
  );
  assert.equal(normalizeYouTubeInput('never gonna give you up'), 'never gonna give you up');
});

test('sanitizeQuery removes control characters and trims', () => {
  assert.equal(sanitizeQuery('  hello\nworld\u0000  '), 'hello world');
  assert.equal(sanitizeQuery('a'.repeat(300), 10).length, 10);
});
