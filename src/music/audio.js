import { spawn } from 'node:child_process';
import path from 'node:path';
import { createAudioResource, StreamType } from '@discordjs/voice';
import { UserError } from '../util/errors.js';

const OPUS_EXTENSIONS = new Set(['.webm', '.opus', '.ogg']);
const MAX_STDERR_BYTES = 16 * 1024;

/**
 * Ask ffmpeg what the first audio stream is. ffmpeg exits with code 1 when no
 * output file is given, so only stderr matters.
 *
 * @param {string} filePath
 * @param {string} ffmpegPath
 * @returns {Promise<string | null>}
 */
export async function probeAudioCodec(filePath, ffmpegPath) {
  return new Promise((resolve) => {
    const child = spawn(ffmpegPath, ['-hide_banner', '-i', filePath], {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    });

    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve(null);
    }, 10_000);

    child.stderr.on('data', (chunk) => {
      if (stderr.length < MAX_STDERR_BYTES) stderr += chunk.toString('utf8');
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on('close', () => {
      clearTimeout(timer);
      const match = stderr.match(/Stream #\d+:\d+.*?: Audio: ([a-zA-Z0-9_]+)/);
      resolve(match?.[1]?.toLowerCase() ?? null);
    });
  });
}

/**
 * @param {string} filePath
 * @param {string | null} codec
 */
export function isOpusSource(filePath, codec) {
  if (codec) return codec === 'opus';
  return OPUS_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

/**
 * Create an Ogg/Opus audio resource for @discordjs/voice.
 *
 * Opus sources are remuxed with `-c:a copy`, so the original YouTube audio is
 * passed through untouched (no decode/re-encode generation loss). Non-Opus
 * sources are encoded with libopus at the selected bitrate.
 *
 * @param {{
 *   filePath: string,
 *   codec: string | null,
 *   seekMs: number,
 *   volume: number,
 *   normalize: boolean,
 *   bitrateKbps: number,
 *   ffmpegPath: string,
 *   tempDir: string,
 *   logger: ReturnType<typeof import('../logger.js').createLogger>,
 * }} options
 */
export function createPlaybackResource(options) {
  const {
    filePath,
    codec,
    seekMs,
    volume,
    normalize,
    bitrateKbps,
    ffmpegPath,
    tempDir,
    logger,
  } = options;

  const opus = isOpusSource(filePath, codec);
  const gain = Math.max(0, Math.min(2, volume / 100));
  const needsFilter = normalize || volume !== 100;
  const copy = opus && !needsFilter;

  if (!copy && !ffmpegPath) {
    throw new UserError('ffmpeg is not configured on the host.', { code: 'FFMPEG_MISSING' });
  }

  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-nostdin',
    '-ss',
    (Math.max(0, seekMs) / 1000).toFixed(3),
    '-i',
    filePath,
    '-vn',
    '-map',
    '0:a:0',
    '-ar',
    '48000',
    '-ac',
    '2',
  ];

  if (copy) {
    args.push('-c:a', 'copy');
  } else {
    const filters = [];
    if (normalize) filters.push('loudnorm=I=-16:TP=-1.5:LRA=11');
    if (volume !== 100) filters.push(`volume=${gain.toFixed(4)}`);
    if (filters.length > 0 && gain > 1) filters.push('alimiter=limit=0.95');
    if (filters.length > 0) args.push('-af', filters.join(','));

    const bitrate = Math.max(32, Math.min(512, Math.round(bitrateKbps)));
    args.push(
      '-c:a',
      'libopus',
      '-b:a',
      `${bitrate}k`,
      '-vbr',
      'on',
      '-compression_level',
      '10',
      '-application',
      'audio',
      '-frame_duration',
      '20',
    );
  }

  args.push('-f', 'ogg', '-page_duration', '100000', '-flush_packets', '1', 'pipe:1');

  const child = spawn(ffmpegPath, args, {
    cwd: path.dirname(filePath),
    env: {
      ...process.env,
      TEMP: tempDir,
      TMP: tempDir,
      TMPDIR: tempDir,
    },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  child.stderr.on('data', (chunk) => {
    if (stderr.length < MAX_STDERR_BYTES) stderr += chunk.toString('utf8');
  });

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    try {
      child.kill('SIGKILL');
    } catch {
      // Already exited.
    }
    // Do not destroy resource.playStream here. AudioPlayer.play()/stop()
    // destroys the old stream itself; destroying it early can look like a
    // natural end and make the queue advance twice.
  };

  const completion = new Promise((resolve) => {
    child.on('error', (error) => {
      logger.warn('ffmpeg could not start', error);
      resolve({ code: -1, signal: null, stderr: error.message });
    });
    child.on('close', (code, signal) => {
      if (code !== 0 && code !== null) {
        logger.warn(`ffmpeg exited with code ${code}`, { stderr: stderr.trim() });
      }
      resolve({ code: code ?? -1, signal, stderr: stderr.trim() });
    });
  });

  const resource = createAudioResource(child.stdout, {
    inputType: StreamType.OggOpus,
    metadata: { filePath, codec },
  });

  return { resource, process: child, cleanup, completion, copy };
}
