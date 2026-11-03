import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { REST, Routes } from 'discord.js';
import { commandPayloads } from './commands/index.js';

/**
 * Register slash commands. Guild commands are instant; global commands can
 * take up to an hour to appear. The payload hash is cached so restarts do not
 * re-register an unchanged command set.
 *
 * @param {ReturnType<typeof import('./config.js').loadConfig>} config
 * @param {ReturnType<typeof import('./logger.js').createLogger>} logger
 * @param {{ force?: boolean }} [options]
 */
export async function deployCommands(config, logger, options = {}) {
  const body = commandPayloads();
  const hash = crypto
    .createHash('sha256')
    .update(JSON.stringify({ clientId: config.clientId, guildId: config.guildId, body }))
    .digest('hex');
  const hashFile = path.join(
    config.dataDir,
    `commands-${config.guildId ?? 'global'}-${config.clientId}.sha256`,
  );

  if (!options.force) {
    const previous = await fs.readFile(hashFile, 'utf8').catch(() => null);
    if (previous?.trim() === hash) {
      logger.info('Slash commands are already up to date; skipping registration. Use --force to re-register.');
      return { scope: config.guildId ? 'guild' : 'global', count: body.length, skipped: true };
    }
  }

  const rest = new REST({ version: '10' }).setToken(config.token);

  if (config.guildId) {
    await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body });
    await fs.mkdir(config.dataDir, { recursive: true });
    await fs.writeFile(hashFile, hash).catch(() => {});
    logger.info(`Registered ${body.length} guild slash command(s) in ${config.guildId}`);
    return { scope: 'guild', count: body.length, skipped: false };
  }

  await rest.put(Routes.applicationCommands(config.clientId), { body });
  await fs.mkdir(config.dataDir, { recursive: true });
  await fs.writeFile(hashFile, hash).catch(() => {});
  logger.info(`Registered ${body.length} global slash command(s); Discord may take up to an hour to show them.`);
  return { scope: 'global', count: body.length, skipped: false };
}
