import test from 'node:test';
import assert from 'node:assert/strict';
import { TrackQueue } from '../src/music/queue.js';
import { QueueFullError, UserError } from '../src/util/errors.js';

function track(id) {
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

test('queue adds, shifts, and reports positions', () => {
  const queue = new TrackQueue(3);
  assert.equal(queue.add(track('a')), 1);
  assert.equal(queue.addNext(track('b')), 1);
  assert.equal(queue.length, 2);
  assert.equal(queue.peek().id, 'b');
  assert.equal(queue.shift().id, 'b');
  assert.equal(queue.length, 1);
});

test('queue rejects overflow', () => {
  const queue = new TrackQueue(1);
  queue.add(track('a'));
  assert.throws(() => queue.add(track('b')), QueueFullError);
});

test('queue remove and move use 1-based positions', () => {
  const queue = new TrackQueue(5);
  queue.add(track('a'));
  queue.add(track('b'));
  queue.add(track('c'));

  assert.equal(queue.remove(2).id, 'b');
  assert.deepEqual(queue.tracks.map((item) => item.id), ['a', 'c']);

  queue.move(2, 1);
  assert.deepEqual(queue.tracks.map((item) => item.id), ['c', 'a']);
  assert.throws(() => queue.remove(0), UserError);
  assert.throws(() => queue.move(1, 9), UserError);
});

test('queue shuffle is deterministic with a supplied RNG', () => {
  const queue = new TrackQueue(5);
  for (const id of ['a', 'b', 'c', 'd']) queue.add(track(id));
  queue.shuffle(() => 0);
  assert.deepEqual(queue.tracks.map((item) => item.id), ['b', 'c', 'd', 'a']);
});

test('queue skip removes from the front', () => {
  const queue = new TrackQueue(5);
  for (const id of ['a', 'b', 'c']) queue.add(track(id));
  assert.deepEqual(queue.skip(2).map((item) => item.id), ['a', 'b']);
  assert.deepEqual(queue.tracks.map((item) => item.id), ['c']);
});

test('queue clear empties and returns count', () => {
  const queue = new TrackQueue(5);
  queue.add(track('a'));
  queue.add(track('b'));
  assert.equal(queue.clear(), 2);
  assert.equal(queue.isEmpty, true);
});

test('queue onChange fires only for real mutations', () => {
  const queue = new TrackQueue(5);
  let changes = 0;
  queue.onChange = () => {
    changes++;
  };

  queue.add(track('a'));
  assert.equal(changes, 1);
  queue.addNext(track('b'));
  assert.equal(changes, 2);
  queue.shift();
  assert.equal(changes, 3);
  queue.add(track('c'));
  assert.equal(changes, 4);
  queue.remove(1);
  assert.equal(changes, 5);
  queue.add(track('d'));
  assert.equal(changes, 6);
  queue.move(1, 2);
  assert.equal(changes, 7);
  queue.move(1, 1);
  assert.equal(changes, 7);
  queue.shuffle(() => 0);
  assert.equal(changes, 8);
  queue.skip(0);
  assert.equal(changes, 8);
  queue.skip(1);
  assert.equal(changes, 9);
  queue.clear();
  assert.equal(changes, 10);
  queue.clear();
  assert.equal(changes, 10);
});
