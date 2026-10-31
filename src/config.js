import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpegStatic from 'ffmpeg-static';

export const ROOT_DIR = fileURLToPath(new URL('..', import.meta.url));

const SNOWFLAKE_RE = /^\d{17,20}$/;
const HEX_COLOR_RE = /^#?([0-9a-f]{6})$/i;

function readString(env, name, fallback = '') {
  const value = env[name];
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function requireString(env, name, errors) {
  const value = readString(env, name);
  if (!value) errors.push(`${name} is required.`);
  return value;
}

function readInt(env, name, fallback, { min = -Infinity, max = Infinity } = {}, errors = []) {
  const raw = readString(env, name);
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    errors.push(`${name} must be an integer between ${min} and ${max}.`);
    return fallback;
  }
  return value;
}

function readBool(env, name, fallback, errors = []) {
  const raw = readString(env, name).toLowerCase();
  if (!raw) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  errors.push(`${name} must be true or false.`);
  return fallback;
}

function readList(env, name) {
  return readString(env, name)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function resolvePath(value, fallback) {
  const raw = value || fallback;
  return path.isAbsolute(raw) ? path.normalize(raw) : path.resolve(ROOT_DIR, raw);
}

function exists(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function defaultYtDlpPath() {
  if (process.platform === 'win32') return path.join(ROOT_DIR, 'tools', 'yt-dlp.exe');
  return path.join(ROOT_DIR, 'tools', 'yt-dlp');
}

/**
 * Load and validate runtime configuration from environment variables.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @param {{ requireToken?: boolean, checkTools?: boolean, rootDir?: string, validateCredentials?: boolean }} [options]
 */
export function loadConfig(env = process.env, options = {}) {
  const { requireToken = true, checkTools = true, validateCredentials = true } = options;
  const errors = [];

  const token = requireToken ? requireString(env, 'DISCORD_TOKEN', errors) : readString(env, 'DISCORD_TOKEN');
  const clientId = requireString(env, 'DISCORD_CLIENT_ID', errors);
  const guildId = readString(env, 'DISCORD_GUILD_ID');

  if (validateCredentials && token && (token === 'your_bot_token_here' || token.length < 20)) {
    errors.push('DISCORD_TOKEN does not look like a bot token. Reset it in the Developer Portal.');
  }
  if (validateCredentials && clientId && !SNOWFLAKE_RE.test(clientId)) {
    errors.push('DISCORD_CLIENT_ID must be a Discord application ID (17-20 digits).');
  }
  if (validateCredentials && guildId && !SNOWFLAKE_RE.test(guildId)) {
    errors.push('DISCORD_GUILD_ID must be a Discord server ID (17-20 digits).');
  }

  const djRoleIds = readList(env, 'DJ_ROLE_IDS');
  for (const roleId of djRoleIds) {
    if (!SNOWFLAKE_RE.test(roleId)) errors.push(`DJ_ROLE_IDS contains an invalid role ID: ${roleId}`);
  }

  const allowedTextChannelIds = readList(env, 'ALLOWED_TEXT_CHANNEL_IDS');
  for (const channelId of allowedTextChannelIds) {
    if (!SNOWFLAKE_RE.test(channelId)) {
      errors.push(`ALLOWED_TEXT_CHANNEL_IDS contains an invalid channel ID: ${channelId}`);
    }
  }

  const defaultVolume = readInt(env, 'DEFAULT_VOLUME', 100, { min: 0, max: 200 }, errors);
  const maxQueueSize = readInt(env, 'MAX_QUEUE_SIZE', 100, { min: 1, max: 500 }, errors);
  const maxTrackMinutes = readInt(env, 'MAX_TRACK_MINUTES', 120, { min: 1, max: 600 }, errors);
  const maxPlaylistItems = readInt(env, 'MAX_PLAYLIST_ITEMS', 50, { min: 1, max: 200 }, errors);
  const idleDisconnectSeconds = readInt(env, 'IDLE_DISCONNECT_SECONDS', 300, { min: 0, max: 86400 }, errors);
  const maxBitrateKbps = readInt(env, 'MAX_BITRATE_KBPS', 256, { min: 32, max: 512 }, errors);
  const preloadConcurrency = readInt(env, 'PRELOAD_CONCURRENCY', 2, { min: 1, max: 4 }, errors);
  const cacheMaxMb = readInt(env, 'AUDIO_CACHE_MAX_MB', 2048, { min: 64, max: 1024 * 1024 }, errors);
  const ytdlpConcurrency = readInt(env, 'YTDLP_CONCURRENCY', 4, { min: 1, max: 16 }, errors);
  const commandCooldownSeconds = readInt(env, 'COMMAND_COOLDOWN_SECONDS', 2, { min: 0, max: 60 }, errors);
  const ytdlpMaxAgeDays = readInt(env, 'YTDLP_MAX_AGE_DAYS', 45, { min: 0, max: 3650 }, errors);
  const ytdlpDownloadTimeoutMinutes = readInt(
    env,
    'YTDLP_DOWNLOAD_TIMEOUT_MINUTES',
    30,
    { min: 10, max: 240 },
    errors,
  );

  const embedColorRaw = readString(env, 'EMBED_COLOR', '#5865F2');
  const colorMatch = embedColorRaw.match(HEX_COLOR_RE);
  if (!colorMatch) errors.push('EMBED_COLOR must be a hex color such as #5865F2.');
  const embedColor = colorMatch ? Number.parseInt(colorMatch[1], 16) : 0x5865f2;

  const ffmpegPath = resolvePath(
    readString(env, 'FFMPEG_PATH'),
    ffmpegStatic || (process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'),
  );
  const ytdlpPath = resolvePath(readString(env, 'YTDLP_PATH'), defaultYtDlpPath());

  const cookiesRaw = readString(env, 'YOUTUBE_COOKIES_FILE');
  const cookiesFile = cookiesRaw ? resolvePath(cookiesRaw, cookiesRaw) : null;
  if (cookiesFile && checkTools && !exists(cookiesFile)) {
    errors.push(`YOUTUBE_COOKIES_FILE does not exist: ${cookiesFile}`);
  }

  const joinSoundRaw = readString(env, 'JOIN_SOUND_FILE');
  const joinSoundFile = joinSoundRaw ? resolvePath(joinSoundRaw, joinSoundRaw) : null;
  if (joinSoundFile && checkTools && !exists(joinSoundFile)) {
    errors.push(`JOIN_SOUND_FILE does not exist: ${joinSoundFile}`);
  }

  const leaveSoundRaw = readString(env, 'LEAVE_SOUND_FILE');
  const leaveSoundFile = leaveSoundRaw ? resolvePath(leaveSoundRaw, leaveSoundRaw) : null;
  if (leaveSoundFile && checkTools && !exists(leaveSoundFile)) {
    errors.push(`LEAVE_SOUND_FILE does not exist: ${leaveSoundFile}`);
  }

  const soundVolume = readInt(env, 'SOUND_VOLUME', 100, { min: 0, max: 200 }, errors);
  const soundMaxSeconds = readInt(env, 'SOUND_MAX_SECONDS', 5, { min: 0, max: 30 }, errors);

  if (checkTools) {
    if (!exists(ytdlpPath)) {
      errors.push(`yt-dlp was not found at ${ytdlpPath}. Run "npm run setup".`);
    }
    if (!exists(ffmpegPath)) {
      errors.push(
        `ffmpeg was not found at ${ffmpegPath}. Run "npm rebuild ffmpeg-static" or set FFMPEG_PATH.`,
      );
    }
  }

  const dataDir = resolvePath(readString(env, 'DATA_DIR'), './data');
  const cacheDir = resolvePath(readString(env, 'AUDIO_CACHE_DIR'), path.join(dataDir, 'cache'));

  const logLevel = readString(env, 'LOG_LEVEL', 'info').toLowerCase();
  if (!['debug', 'info', 'warn', 'error', 'silent'].includes(logLevel)) {
    errors.push('LOG_LEVEL must be one of: debug, info, warn, error, silent.');
  }

  const preloadAhead = readInt(env, 'PRELOAD_AHEAD', 3, { min: 0, max: 10 }, errors);
  const autoSetChannelBitrate = readBool(env, 'AUTO_SET_CHANNEL_BITRATE', true, errors);
  const autoDeployCommands = readBool(env, 'AUTO_DEPLOY_COMMANDS', true, errors);
  const nowPlayingMessages = readBool(env, 'NOW_PLAYING_MESSAGES', true, errors);
  const audioNormalize = readBool(env, 'AUDIO_NORMALIZE', false, errors);
  const restoreChannelBitrate = readBool(env, 'RESTORE_CHANNEL_BITRATE', true, errors);

  if (errors.length > 0) {
    const error = new Error(`Invalid configuration:\n- ${errors.join('\n- ')}`);
    error.name = 'ConfigError';
    throw error;
  }

  return Object.freeze({
    token,
    clientId,
    guildId: guildId || null,
    djRoleIds,
    allowedTextChannelIds,
    defaultVolume,
    maxQueueSize,
    maxTrackSeconds: maxTrackMinutes * 60,
    maxPlaylistItems,
    idleDisconnectSeconds,
    maxBitrateKbps,
    autoSetChannelBitrate,
    preloadAhead,
    preloadConcurrency,
    ytdlpConcurrency,
    commandCooldownSeconds,
    ytdlpMaxAgeDays,
    ytdlpDownloadTimeoutMinutes,
    autoDeployCommands,
    nowPlayingMessages,
    audioNormalize,
    restoreChannelBitrate,
    joinSoundFile,
    leaveSoundFile,
    soundVolume,
    soundMaxSeconds,
    embedColor,
    ffmpegPath,
    ytdlpPath,
    cookiesFile,
    dataDir,
    cacheDir,
    tempDir: resolvePath(readString(env, 'TEMP_DIR'), path.join(dataDir, 'tmp')),
    ytdlpCacheDir: resolvePath(readString(env, 'YTDLP_CACHE_DIR'), path.join(dataDir, 'yt-dlp-cache')),
    cacheMaxBytes: cacheMaxMb * 1024 * 1024,
    logLevel,
    nodePath: process.execPath,
    rootDir: ROOT_DIR,
    version: '1.0.0',
  });
}

/** The permissions integer used in README invite links. */
export const INVITE_PERMISSIONS = '3165200'; // View Channel, Send Messages, Embed Links, Connect, Speak, Manage Channels
