import test from 'node:test';
import assert from 'node:assert/strict';
import { commandPayloads, commands } from '../src/commands/index.js';

test('all command names are unique and valid', () => {
  const payloads = commandPayloads();
  const names = payloads.map((command) => command.name);
  assert.equal(new Set(names).size, names.length);
  for (const name of names) {
    assert.match(name, /^[a-z0-9-]{1,32}$/);
  }
  assert.ok(names.includes('play'));
  assert.ok(names.includes('search'));
  assert.ok(names.includes('skip'));
  assert.ok(names.includes('stop'));
  assert.ok(names.includes('queue'));
});

test('every command has a description and execute function', () => {
  for (const command of commands) {
    assert.equal(typeof command.data.description, 'string');
    assert.ok(command.data.description.length > 0);
    assert.equal(typeof command.execute, 'function');
  }
});

test('play requires a query and offers next/playlist options', () => {
  const play = commandPayloads().find((command) => command.name === 'play');
  const optionNames = play.options.map((option) => option.name);
  assert.deepEqual(optionNames, ['query', 'next', 'playlist']);
  assert.equal(play.options.find((option) => option.name === 'query').required, true);
});
