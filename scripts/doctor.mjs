import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { REST, Routes } from 'discord.js';
import { loadConfig } from '../src/config.js';
import { createLogger } from '../src/logger.js';
import { runDiagnostics } from '../src/services/diagnostics.js';
import { MediaCache } from '../src/music/cache.js';

const root = fileURLToPath(new URL('..', import.meta.url));
dotenv.config({ path: path.join(root, '.env'), quiet: true });

if (!fs.existsSync(path.join(root, '.env'))) {
  console.error('No .env file found. Run "npm run setup", then fill in .env.');
  process.exit(1);
}

let config;
try {
  config = loadConfig(process.env, {
    requireToken: false,
    checkTools: false,
    validateCredentials: false,
  });
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const logger = createLogger('warn', 'doctor');
const cache = new MediaCache({
  dir: config.cacheDir,
  maxBytes: config.cacheMaxBytes,
  youtube: { download: async () => { throw new Error('diagnostics only'); } },
  logger: createLogger('silent', 'doctor-cache'),
});
await cache.init();

const checks = await runDiagnostics(config, cache, logger);

if (config.token) {
  try {
    const rest = new REST({ version: '10' }).setToken(config.token);
    const me = await rest.get(Routes.user());
    checks.push({ name: 'Discord token', ok: true, detail: `${me.username} (${me.id})` });
    if (config.guildId) {
      try {
        const guild = await rest.get(Routes.guild(config.guildId));
        checks.push({ name: 'Discord server', ok: true, detail: `${guild.name} (${guild.id})` });
      } catch {
        checks.push({
          name: 'Discord server',
          ok: false,
          detail: 'DISCORD_GUILD_ID is invalid or the bot is not a member',
        });
      }
    }
  } catch (error) {
    checks.push({
      name: 'Discord token',
      ok: false,
      detail: String(error.message ?? error).slice(0, 200),
    });
  }
} else {
  checks.push({ name: 'Discord token', ok: false, detail: 'DISCORD_TOKEN is empty' });
}

let failures = 0;
for (const check of checks) {
  if (!check.ok) failures++;
  console.log(`${check.ok ? 'OK  ' : 'FAIL'}  ${check.name.padEnd(20)} ${check.detail}`);
}

console.log('');
if (failures > 0) {
  console.log(`${failures} check(s) failed. Fix the items marked FAIL before starting the bot.`);
  process.exit(1);
}
console.log('All checks passed.');
