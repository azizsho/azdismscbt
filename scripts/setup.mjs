#!/usr/bin/env node
/**
 * Prepare a host: verify Node, download yt-dlp with checksum verification,
 * and check ffmpeg/opus. Safe to run repeatedly.
 *
 * Usage: node scripts/setup.mjs [--force]
 */
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpegStatic from 'ffmpeg-static';
import { buildChildEnv } from '../src/util/child-env.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FORCE = process.argv.includes('--force');
const RELEASE_BASE = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download';

function log(message) {
  process.stdout.write(`${message}\n`);
}

function fail(message) {
  process.stderr.write(`\nERROR: ${message}\n`);
  process.exit(1);
}

function assetForPlatform() {
  const { platform, arch } = process;
  if (platform === 'win32') {
    if (arch === 'x64') return { name: 'yt-dlp.exe', executable: 'yt-dlp.exe' };
    if (arch === 'arm64') return { name: 'yt-dlp_arm64.exe', executable: 'yt-dlp.exe' };
    if (arch === 'ia32') return { name: 'yt-dlp_x86.exe', executable: 'yt-dlp.exe' };
  }
  if (platform === 'linux') {
    if (arch === 'x64') return { name: 'yt-dlp_linux', executable: 'yt-dlp' };
    if (arch === 'arm64') return { name: 'yt-dlp_linux_aarch64', executable: 'yt-dlp' };
    if (arch === 'arm') return { name: 'yt-dlp_linux_armv7l', executable: 'yt-dlp' };
  }
  if (platform === 'darwin') return { name: 'yt-dlp_macos', executable: 'yt-dlp' };
  throw new Error(`Unsupported platform: ${platform}/${arch}`);
}

async function download(url, destination, timeoutMs = 180_000) {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'user-agent': 'discord-youtube-music-bot-setup' },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(destination, bytes);
  return bytes;
}

async function sha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fsSync.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function run(command, args, options = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, {
        env: buildChildEnv(options.env),
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      resolve({ code: -1, stdout: '', stderr: error.message });
      return;
    }

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), options.timeoutMs ?? 20_000);
    child.stdout.on('data', (chunk) => (stdout += chunk.toString('utf8')));
    child.stderr.on('data', (chunk) => (stderr += chunk.toString('utf8')));
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: error.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

async function installYtDlp() {
  const { name, executable } = assetForPlatform();
  const toolsDir = path.join(ROOT, 'tools');
  const target = path.join(toolsDir, executable);
  await fs.mkdir(toolsDir, { recursive: true });

  if (!FORCE && fsSync.existsSync(target)) {
    const version = await run(target, ['--version'], {
      env: { TEMP: path.join(ROOT, 'data', 'tmp'), TMP: path.join(ROOT, 'data', 'tmp') },
    });
    if (version.code === 0) {
      log(`yt-dlp is already installed: ${version.stdout.trim()}`);
      return target;
    }
    log('Existing yt-dlp did not run; reinstalling.');
  }

  log(`Downloading yt-dlp (${name})…`);
  const temp = path.join(toolsDir, `${executable}.download`);
  try {
    await download(`${RELEASE_BASE}/${name}`, temp);
  } catch (error) {
    fail(
      `Could not download yt-dlp: ${error.message}\n` +
        'Check the host internet connection/firewall, then run "npm run setup" again.',
    );
  }

  log('Verifying SHA-256 checksum…');
  let expected = null;
  try {
    const sumsResponse = await fetch(`${RELEASE_BASE}/SHA2-256SUMS`, {
      redirect: 'follow',
      signal: AbortSignal.timeout(60_000),
    });
    if (sumsResponse.ok) {
      const sums = await sumsResponse.text();
      const line = sums.split(/\r?\n/).find((row) => row.trim().endsWith(` ${name}`));
      expected = line?.trim().split(/\s+/)[0] ?? null;
    }
  } catch {
    // Checksum download is best-effort; the binary was fetched over HTTPS from GitHub.
  }

  if (expected) {
    const actual = await sha256(temp);
    if (actual.toLowerCase() !== expected.toLowerCase()) {
      await fs.rm(temp, { force: true });
      fail('yt-dlp checksum did not match. The download may be corrupt; try again.');
    }
    log('Checksum OK.');
  } else {
    log('Checksum file unavailable; continuing with HTTPS download.');
  }

  await fs.rm(target, { force: true });
  await fs.rename(temp, target);
  if (process.platform !== 'win32') await fs.chmod(target, 0o755);
  log(`yt-dlp installed at ${target}`);
  return target;
}

async function checkFfmpeg() {
  const ffmpegPath = process.env.FFMPEG_PATH
    ? path.resolve(process.env.FFMPEG_PATH)
    : ffmpegStatic;

  if (!ffmpegPath || !fsSync.existsSync(ffmpegPath)) {
    fail(
      'ffmpeg is missing.\n' +
        'Run "npm rebuild ffmpeg-static" (or "npm install" again), or install ffmpeg and set FFMPEG_PATH.',
    );
  }

  const version = await run(ffmpegPath, ['-hide_banner', '-version']);
  if (version.code !== 0) {
    fail(`ffmpeg at ${ffmpegPath} did not run:\n${version.stderr}`);
  }

  const encoders = await run(ffmpegPath, ['-hide_banner', '-encoders']);
  if (!/\blibopus\b/.test(encoders.stdout)) {
    fail(`ffmpeg at ${ffmpegPath} does not include libopus. Install a full ffmpeg build.`);
  }

  log(`ffmpeg OK: ${version.stdout.split(/\r?\n/)[0]}`);
  log('libopus encoder OK.');
  return ffmpegPath;
}

async function ensureEnvFile() {
  const envPath = path.join(ROOT, '.env');
  const examplePath = path.join(ROOT, '.env.example');
  if (fsSync.existsSync(envPath)) {
    log('.env already exists; leaving it untouched.');
    return false;
  }
  if (!fsSync.existsSync(examplePath)) return false;
  await fs.copyFile(examplePath, envPath);
  log('Created .env from .env.example.');
  return true;
}

async function main() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 22) fail(`Node.js 22 or newer is required. Current: ${process.version}`);

  log(`Node.js ${process.version} OK.`);
  await fs.mkdir(path.join(ROOT, 'data', 'tmp'), { recursive: true });
  await fs.mkdir(path.join(ROOT, 'data', 'cache'), { recursive: true });
  await fs.mkdir(path.join(ROOT, 'data', 'yt-dlp-cache'), { recursive: true });

  const ffmpeg = await checkFfmpeg();
  const ytdlp = await installYtDlp();
  const createdEnv = await ensureEnvFile();

  log('');
  log('Setup complete.');
  log(`  ffmpeg: ${ffmpeg}`);
  log(`  yt-dlp: ${ytdlp}`);
  if (createdEnv) log('  .env:   created — fill in DISCORD_TOKEN and DISCORD_CLIENT_ID.');
  log('');
  log('Next steps:');
  let step = 1;
  if (createdEnv) log(`  ${step++}. Open .env and fill in your bot token and application ID.`);
  log(`  ${step++}. Run: npm run doctor`);
  log(`  ${step++}. Run: npm run deploy`);
  log(`  ${step}. Run: npm start`);
  log('');
  log('For a Windows boot task, run (in an elevated PowerShell):');
  log('  powershell -ExecutionPolicy Bypass -File scripts/install-windows-task.ps1');
}

await main();
