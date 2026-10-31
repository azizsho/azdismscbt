import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpegPath from 'ffmpeg-static';
import { createPlaybackResource, probeAudioCodec } from '../src/music/audio.js';
import { createLogger } from '../src/logger.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const hasFfmpeg = Boolean(ffmpegPath && fsSync.existsSync(ffmpegPath));

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(stderr))));
  });
}

test(
  'ffmpeg produces Opus and the voice pipeline emits packets',
  { skip: !hasFfmpeg },
  async () => {
    const dir = path.join(root, 'data', 'test-audio');
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, 'tone.ogg');
    await run(ffmpegPath, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=1',
      '-c:a',
      'libopus',
      '-b:a',
      '128k',
      file,
    ]);

    const codec = await probeAudioCodec(file, ffmpegPath);
    assert.equal(codec, 'opus');

    const playback = createPlaybackResource({
      filePath: file,
      codec,
      seekMs: 250,
      volume: 100,
      normalize: false,
      bitrateKbps: 256,
      ffmpegPath,
      tempDir: dir,
      logger: createLogger('silent'),
    });

    assert.equal(playback.copy, true);
    let packets = 0;
    for await (const packet of playback.resource.playStream) {
      assert.ok(Buffer.isBuffer(packet));
      packets++;
      if (packets >= 10) break;
    }
    playback.cleanup();
    assert.ok(packets >= 10);

    await fs.rm(dir, { recursive: true, force: true });
  },
);
