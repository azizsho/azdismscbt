import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * Run a short-lived diagnostic command without a shell.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {{ timeoutMs?: number, env?: NodeJS.ProcessEnv }} [options]
 */
function runCommand(command, args, options = {}) {
  const { timeoutMs = 10_000 } = options;
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, {
        env: { ...process.env, ...options.env },
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      resolve({ code: -1, stdout: '', stderr: error.message });
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      resolve({ code: -1, stdout, stderr: `${stderr}\nTimed out` });
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      if (stdout.length < 256 * 1024) stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      if (stderr.length < 256 * 1024) stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: error.message });
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

/**
 * @param {ReturnType<import('../config.js').loadConfig>} config
 * @param {import('../music/cache.js').MediaCache} cache
 * @param {ReturnType<import('../logger.js').createLogger>} logger
 * @returns {Promise<Array<{ name: string, ok: boolean, detail: string }>>}
 */
export async function runDiagnostics(config, cache, logger) {
  const checks = [];

  // PyInstaller's yt-dlp binary needs a writable TEMP directory. Create all
  // runtime folders before probing tools; a missing TEMP can make startup hang.
  await Promise.all([
    fs.mkdir(config.dataDir, { recursive: true }),
    fs.mkdir(config.tempDir, { recursive: true }),
    fs.mkdir(config.cacheDir, { recursive: true }),
    fs.mkdir(config.ytdlpCacheDir, { recursive: true }),
  ]).catch(() => {});

  checks.push({
    name: 'Node.js',
    ok: Number(process.versions.node.split('.')[0]) >= 22,
    detail: `${process.version} on ${process.platform}/${process.arch}`,
  });

  const ffmpegVersion = await runCommand(config.ffmpegPath, ['-hide_banner', '-version'], {
    timeoutMs: 8_000,
  });
  const ffmpegFirstLine = ffmpegVersion.stdout.split(/\r?\n/)[0] || 'no output';
  const encoders = await runCommand(config.ffmpegPath, ['-hide_banner', '-encoders'], {
    timeoutMs: 8_000,
  });
  checks.push({
    name: 'ffmpeg',
    ok: ffmpegVersion.code === 0,
    detail: ffmpegVersion.code === 0 ? ffmpegFirstLine.slice(0, 120) : ffmpegVersion.stderr.slice(0, 200),
  });
  checks.push({
    name: 'libopus encoder',
    ok: /\blibopus\b/.test(encoders.stdout),
    detail: /\blibopus\b/.test(encoders.stdout)
      ? 'available'
      : 'missing — install an ffmpeg build with libopus',
  });

  const ytdlpVersion = await runCommand(config.ytdlpPath, ['--version'], {
    timeoutMs: 20_000,
    env: { TEMP: config.tempDir, TMP: config.tempDir, TMPDIR: config.tempDir },
  });
  checks.push({
    name: 'yt-dlp',
    ok: ytdlpVersion.code === 0,
    detail:
      ytdlpVersion.code === 0
        ? ytdlpVersion.stdout.trim().slice(0, 80)
        : (ytdlpVersion.stderr || 'not found').slice(0, 200),
  });

  try {
    await fs.mkdir(config.dataDir, { recursive: true });
    await fs.access(config.dataDir, fs.constants.W_OK);
    checks.push({ name: 'Data directory', ok: true, detail: config.dataDir });
  } catch (error) {
    checks.push({ name: 'Data directory', ok: false, detail: error.message });
  }

  checks.push({
    name: 'YouTube cookies',
    ok: true,
    detail: config.cookiesFile ? 'configured' : 'not configured (optional)',
  });

  if (ytdlpVersion.code === 0) {
    const search = await runCommand(
      config.ytdlpPath,
      [
        '--ignore-config',
        '--no-warnings',
        '--no-progress',
        '--flat-playlist',
        '--dump-single-json',
        '--js-runtimes',
        `node:${config.nodePath}`,
        '--ffmpeg-location',
        config.ffmpegPath,
        '--cache-dir',
        config.ytdlpCacheDir,
        '--',
        'ytsearch1:test',
      ],
      {
        timeoutMs: 20_000,
        env: { TEMP: config.tempDir, TMP: config.tempDir, TMPDIR: config.tempDir },
      },
    );
    let ok = false;
    let detail = 'search failed';
    if (search.code === 0) {
      try {
        const json = JSON.parse(search.stdout);
        const count = Array.isArray(json.entries) ? json.entries.length : 0;
        ok = count > 0;
        detail = ok ? `${count} result(s) returned` : 'no results';
      } catch {
        detail = 'unexpected JSON response';
      }
    } else {
      detail = (search.stderr || 'search failed').replace(/\s+/g, ' ').slice(0, 240);
    }
    checks.push({ name: 'YouTube search', ok, detail });

    // Search uses the lightweight tab extractor. Playback uses the player
    // extractor and is where cookie/captcha/PO-token failures usually show up.
    const sampleVideo = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
    const extraction = await runCommand(
      config.ytdlpPath,
      [
        '--ignore-config',
        '--no-warnings',
        '--no-progress',
        '--simulate',
        '--no-playlist',
        '-f',
        'bestaudio[acodec=opus]/bestaudio',
        '--print',
        '%(id)s|%(acodec)s',
        '--js-runtimes',
        `node:${config.nodePath}`,
        '--ffmpeg-location',
        config.ffmpegPath,
        '--cache-dir',
        config.ytdlpCacheDir,
        '--',
        sampleVideo,
      ],
      {
        timeoutMs: 25_000,
        env: { TEMP: config.tempDir, TMP: config.tempDir, TMPDIR: config.tempDir },
      },
    );
    const extractionOutput = extraction.stdout.trim().split(/\r?\n/).filter(Boolean).pop() ?? '';
    const extractionOk = extraction.code === 0 && extractionOutput.includes('|');
    checks.push({
      name: 'YouTube playback',
      ok: extractionOk,
      detail: extractionOk
        ? `extracted ${extractionOutput.slice(0, 100)}`
        : (extraction.stderr || extraction.stdout || 'no output')
            .replace(/\s+/g, ' ')
            .slice(0, 300),
    });
  }

  const stats = cache.getStats();
  checks.push({
    name: 'Audio cache',
    ok: true,
    detail: `${stats.count} file(s), ${(stats.totalBytes / 1024 / 1024).toFixed(1)} / ${(
      stats.maxBytes /
      1024 /
      1024
    ).toFixed(0)} MiB`,
  });
  checks.push({ name: 'Cache folder', ok: true, detail: config.cacheDir });

  const free = await fs
    .statfs(config.dataDir)
    .then((info) => `${(Number(info.bavail * info.bsize) / 1024 / 1024 / 1024).toFixed(1)} GiB free`)
    .catch(() => 'unknown');
  checks.push({ name: 'Disk space', ok: free !== 'unknown', detail: `${free} on ${path.parse(config.dataDir).root}` });

  checks.push({
    name: 'Host',
    ok: true,
    detail: `${os.type()} ${os.release()} • ${(os.totalmem() / 1024 / 1024 / 1024).toFixed(1)} GiB RAM`,
  });

  if (checks.some((check) => !check.ok)) {
    logger.warn('Diagnostics found failing checks', checks.filter((check) => !check.ok));
  }
  return checks;
}
