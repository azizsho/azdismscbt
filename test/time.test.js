import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDuration, formatProgress, parseTimestamp } from '../src/util/time.js';

test('parseTimestamp accepts seconds', () => {
  assert.equal(parseTimestamp('90'), 90);
  assert.equal(parseTimestamp('0'), 0);
});

test('parseTimestamp accepts mm:ss and hh:mm:ss', () => {
  assert.equal(parseTimestamp('1:30'), 90);
  assert.equal(parseTimestamp('01:02:03'), 3723);
  assert.equal(parseTimestamp('0:05'), 5);
});

test('parseTimestamp accepts unit notation', () => {
  assert.equal(parseTimestamp('1h2m3s'), 3723);
  assert.equal(parseTimestamp('2m'), 120);
  assert.equal(parseTimestamp('45s'), 45);
});

test('parseTimestamp rejects invalid values', () => {
  assert.throws(() => parseTimestamp(''));
  assert.throws(() => parseTimestamp('abc'));
  assert.throws(() => parseTimestamp('1:99'));
  assert.throws(() => parseTimestamp('1:2:3:4'));
  assert.throws(() => parseTimestamp('-5'));
  assert.throws(() => parseTimestamp('25h'));
});

test('formatDuration handles hours, minutes, and nulls', () => {
  assert.equal(formatDuration(213), '3:33');
  assert.equal(formatDuration(3723), '1:02:03');
  assert.equal(formatDuration(null), '--:--');
  assert.equal(formatDuration(undefined, { fallback: 'LIVE' }), 'LIVE');
});

test('formatProgress produces a fixed-width bar', () => {
  const text = formatProgress(30, 60, 10);
  assert.match(text, /30:00|0:30/);
  assert.match(text, /●/);

  const live = formatProgress(30, null);
  assert.equal(live, '`LIVE`');
});
