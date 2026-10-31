import test from 'node:test';
import assert from 'node:assert/strict';
import { createLogger } from '../src/logger.js';

test('logger masks token-shaped strings and secret assignments', () => {
  const lines = [];
  const original = process.stderr.write;
  process.stderr.write = (chunk) => {
    lines.push(String(chunk));
    return true;
  };
  try {
    const logger = createLogger('error', 'test');
    const token = `M${'a'.repeat(23)}.abcdef.${'b'.repeat(27)}`;
    logger.error(`login failed token=abc123 ${token}`);
  } finally {
    process.stderr.write = original;
  }

  const text = lines.join('');
  assert.match(text, /token=\[redacted\]/);
  assert.match(text, /\[redacted-token\]/);
  assert.doesNotMatch(text, /aaaaaaaaaaaaaaaaaaaaaaa/);
});
