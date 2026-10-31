import path from 'node:path';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { MediaCache } from './music/cache.js';
import { MusicManager } from './music/manager.js';
import { YouTube } from './music/youtube.js';
import { BitrateRestoreStore } from './services/bitrate-restore.js';
import { GuildSettingsStore } from './services/guild-settings.js';
import { startBot } from './bot.js';

const root = fileURLToPath(new URL('..', import.meta.url));
dotenv.config({ path: path.join(root, '.env'), quiet: true });

let config;
let logger;
try {
  config = loadConfig(process.env);
  logger = createLogger(config.logLevel, 'main');
} catch (error) {
  console.error(`\n${error.message}\n`);
  console.error('Copy .env.example to .env and fill it in, then run "npm run doctor".');
  process.exit(1);
}

await fs.mkdir(config.dataDir, { recursive: true });
await fs.mkdir(config.cacheDir, { recursive: true });
await fs.mkdir(config.tempDir, { recursive: true });
await fs.mkdir(config.ytdlpCacheDir, { recursive: true });

// PID file used by the status/stop helper scripts. A stale file is harmless:
// the scripts verify that the PID still belongs to this bot before using it.
const pidFile = path.join(config.dataDir, 'bot.pid');
const clearPidFile = () => {
  try {
    fsSync.rmSync(pidFile, { force: true });
  } catch {
    // Nothing else to do during shutdown.
  }
};
process.on('exit', clearPidFile);
await fs.writeFile(pidFile, String(process.pid), 'utf8');

const youtube = new YouTube(config, logger);

// Fire-and-forget: login must not wait for the yt-dlp process. This logs the
// version and warns when the binary is old, which is the main cause of YouTube
// extraction breakage.
void youtube
  .versionStatus()
  .then((info) => {
    if (!info?.version) {
      logger.warn('Could not determine the yt-dlp version. Run "npm run update-tools" if downloads fail.');
      return;
    }
    const age = info.ageDays === null ? 'unknown age' : `${info.ageDays} days old`;
    if (info.stale) {
      logger.warn(
        `yt-dlp ${info.version} is ${age}; run "npm run update-tools" to stay ahead of YouTube changes.`,
      );
    } else {
      logger.info(`yt-dlp ${info.version} (${age})`);
    }
  })
  .catch((error) => logger.warn('yt-dlp version check failed; downloads may be affected', error));
/** @type {MusicManager | null} */
let manager = null;
const cache = new MediaCache({
  dir: config.cacheDir,
  maxBytes: config.cacheMaxBytes,
  youtube,
  logger,
  tempDir: config.tempDir,
  isProtected: (id) => manager?.isTrackActive(id) ?? false,
});
await cache.init();

const bitrateRestore = new BitrateRestoreStore(path.join(config.dataDir, 'bitrate-restore.json'));
await bitrateRestore.load();

const guildSettings = new GuildSettingsStore(path.join(config.dataDir, 'guild-settings.json'));
await guildSettings.load();

manager = new MusicManager({ config, logger, cache, youtube, bitrateRestore, settings: guildSettings });

let app;
try {
  app = await startBot({ config, logger, cache, youtube, manager });
} catch (error) {
  logger.error('Could not start the bot', error);
  if (String(error.message).toLowerCase().includes('token')) {
    logger.error('Check DISCORD_TOKEN in .env. Reset the token in the Discord Developer Portal if needed.');
  }
  process.exit(1);
}

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`Received ${signal}; shutting down…`);
  const force = setTimeout(() => process.exit(1), 10_000);
  force.unref();
  try {
    cache.abortAll();
    await manager?.destroyAll();
    await bitrateRestore.flush();
    await guildSettings.flush();
    app?.client.destroy();
  } catch (error) {
    logger.warn('Shutdown error', error);
  } finally {
    clearTimeout(force);
    clearPidFile();
    process.exit(0);
  }
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

// Cross-platform graceful stop used by the Windows scripts. A sentinel file is
// simpler than an HTTP endpoint and lets Node run its normal shutdown path.
const shutdownRequestFile = path.join(config.dataDir, 'shutdown.request');
const shutdownWatcher = setInterval(() => {
  if (!fsSync.existsSync(shutdownRequestFile)) return;
  clearInterval(shutdownWatcher);
  try {
    fsSync.rmSync(shutdownRequestFile, { force: true });
  } catch {
    // Already gone.
  }
  void shutdown('control');
}, 1000);
shutdownWatcher.unref();

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', reason);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception; shutting down', error);
  void shutdown('uncaughtException');
});
