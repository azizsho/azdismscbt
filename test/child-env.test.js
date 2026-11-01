import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { buildChildEnv } from '../src/util/child-env.js';

const SECRETS = {
  DISCORD_TOKEN: 'test-token-value',
  DISCORD_CLIENT_ID: '123456789012345678',
  AWS_SECRET_ACCESS_KEY: 'test-aws-secret',
  DATABASE_URL: 'postgres://user:pass@example.test/db',
};

/** @param {() => T} fn @returns {T} @template T */
function withSecrets(fn) {
  /** @type {Record<string, string | undefined>} */
  const previous = {};
  for (const [key, value] of Object.entries(SECRETS)) {
    previous[key] = process.env[key];
    process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('buildChildEnv drops bot and host secrets but keeps PATH', () => {
  withSecrets(() => {
    const env = buildChildEnv();
    for (const key of Object.keys(SECRETS)) {
      assert.equal(env[key], undefined, `${key} must not reach child processes`);
    }
    assert.ok(env.PATH || env.Path, 'PATH must survive the allowlist');
  });
});

test('buildChildEnv applies tool-specific overrides', () => {
  withSecrets(() => {
    const env = buildChildEnv({
      TEMP: 'C:\\temp',
      TMP: 'C:\\temp',
      TMPDIR: 'C:\\temp',
      PYTHONIOENCODING: 'utf-8',
      NO_COLOR: '1',
    });
    assert.equal(env.TEMP, 'C:\\temp');
    assert.equal(env.TMP, 'C:\\temp');
    assert.equal(env.TMPDIR, 'C:\\temp');
    assert.equal(env.PYTHONIOENCODING, 'utf-8');
    assert.equal(env.NO_COLOR, '1');
    assert.equal(env.DISCORD_TOKEN, undefined);
  });
});

test('a real spawned child cannot see the bot token', () => {
  withSecrets(() => {
    const result = spawnSync(process.execPath, ['-e', 'console.log(JSON.stringify(process.env))'], {
      env: buildChildEnv(),
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    const childEnv = JSON.parse(result.stdout);
    assert.equal(childEnv.DISCORD_TOKEN, undefined);
    assert.equal(childEnv.AWS_SECRET_ACCESS_KEY, undefined);
    assert.equal(childEnv.DATABASE_URL, undefined);
    assert.ok(childEnv.PATH || childEnv.Path, 'child still needs PATH');
  });
});

test('runtime child spawns do not spread process.env', async () => {
  const files = [
    new URL('../src/music/youtube.js', import.meta.url),
    new URL('../src/music/audio.js', import.meta.url),
    new URL('../src/services/diagnostics.js', import.meta.url),
    new URL('../scripts/setup.mjs', import.meta.url),
  ];

  for (const file of files) {
    const source = await readFile(file, 'utf8');
    assert.doesNotMatch(
      source,
      /\.\.\.process\.env/,
      `${file.pathname} still forwards the full parent environment`,
    );
  }
});
