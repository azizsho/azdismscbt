import test from 'node:test';
import assert from 'node:assert/strict';
import { nowPlayingButtons } from '../src/ui/components.js';

test('now-playing buttons carry the guild and track IDs', () => {
  const row = nowPlayingButtons('123456789012345678', false, 'dQw4w9WgXcQ')[0].toJSON();
  const ids = row.components.map((component) => component.custom_id);

  assert.deepEqual(ids, [
    'np:toggle:123456789012345678:dQw4w9WgXcQ',
    'np:skip:123456789012345678:dQw4w9WgXcQ',
    'np:stop:123456789012345678:dQw4w9WgXcQ',
  ]);
});

test('now-playing pause button reflects the paused state', () => {
  const row = nowPlayingButtons('123456789012345678', true, 'dQw4w9WgXcQ')[0].toJSON();
  assert.equal(row.components[0].label, 'Resume');
  assert.equal(row.components[0].emoji.name, '▶️');
});

test('now-playing card exposes previous, replay, loop, and queue controls', () => {
  const rows = nowPlayingButtons('123456789012345678', false, 'dQw4w9WgXcQ');
  assert.equal(rows.length, 2);
  const ids = rows[1].toJSON().components.map((component) => component.custom_id);
  assert.deepEqual(ids, [
    'np:previous:123456789012345678:dQw4w9WgXcQ',
    'np:replay:123456789012345678:dQw4w9WgXcQ',
    'np:loop:123456789012345678:dQw4w9WgXcQ',
    'np:queue:123456789012345678:dQw4w9WgXcQ',
  ]);
});
