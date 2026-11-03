import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSearchSession,
  deleteSearchSession,
  getSearchSession,
  takeSearchSession,
} from '../src/services/search-store.js';

const owner = { guildId: 'guild-1', userId: 'user-1' };

test('search sessions are scoped to their guild and user', () => {
  const token = createSearchSession({ ...owner, query: 'test', tracks: [] });

  assert.equal(getSearchSession(token, owner)?.query, 'test');
  assert.equal(getSearchSession(token, { guildId: 'guild-2', userId: 'user-1' }), null);
  assert.equal(getSearchSession(token, { guildId: 'guild-1', userId: 'user-2' }), null);

  deleteSearchSession(token);
  assert.equal(getSearchSession(token, owner), null);
});

test('peeking does not consume a session; take does', () => {
  const token = createSearchSession({ ...owner, query: 'peek', tracks: [] });

  assert.ok(getSearchSession(token, owner));
  assert.ok(getSearchSession(token, owner));
  assert.ok(takeSearchSession(token, owner));
  assert.equal(takeSearchSession(token, owner), null);
});
