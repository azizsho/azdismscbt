import { Client, Events, GatewayIntentBits, ActivityType, MessageFlags } from 'discord.js';
import { commandMap, commands } from './commands/index.js';
import { deployCommands } from './deploy.js';
import { handleButton, handleSelect } from './interactions/handlers.js';
import { assertAllowedChannel } from './util/checks.js';
import { errorEmbed } from './ui/embeds.js';
import { UserError } from './util/errors.js';
import { INVITE_PERMISSIONS } from './config.js';

/**
 * @param {{
 *   config: ReturnType<typeof import('./config.js').loadConfig>,
 *   logger: ReturnType<typeof import('./logger.js').createLogger>,
 *   cache: import('./music/cache.js').MediaCache,
 *   youtube: import('./music/youtube.js').YouTube,
 *   manager: import('./music/manager.js').MusicManager,
 * }} deps
 */
export async function startBot(deps) {
  const { config, logger, cache, youtube, manager } = deps;
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
  });

  const ctx = { config, logger, cache, youtube, music: manager, commands };

  /** @type {Map<string, number>} */
  const cooldowns = new Map();
  const COOLDOWN_COMMANDS = new Set(['play', 'search']);
  const cooldownMs = Math.max(0, config.commandCooldownSeconds) * 1000;

  client.once(Events.ClientReady, async (readyClient) => {
    logger.info(`Logged in as ${readyClient.user.tag} (${readyClient.user.id})`);
    logger.info(`Connected to ${readyClient.guilds.cache.size} server(s)`);
    readyClient.user.setPresence({
      status: 'online',
      activities: [{ name: '/play • music', type: ActivityType.Listening }],
    });

    if (config.guildId && !readyClient.guilds.cache.has(config.guildId)) {
      logger.warn(
        `DISCORD_GUILD_ID (${config.guildId}) is not one of my servers. Invite me first, or remove it to use global commands.`,
      );
    }

    if (readyClient.guilds.cache.size === 0) {
      logger.warn(
        `I am not in any server yet. Invite me with:\nhttps://discord.com/oauth2/authorize?client_id=${config.clientId}&permissions=${INVITE_PERMISSIONS}&scope=bot%20applications.commands`,
      );
    }

    try {
      await manager.restorePersistedBitrates(readyClient);
    } catch (error) {
      logger.warn('Could not restore persisted channel bitrates', error);
    }

    if (config.autoDeployCommands) {
      try {
        await deployCommands(config, logger);
      } catch (error) {
        logger.error('Automatic slash-command registration failed. Run "npm run deploy".', error);
      }
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      assertAllowedChannel(interaction, config);

      if (interaction.isChatInputCommand()) {
        const command = commandMap.get(interaction.commandName);
        if (!command) {
          logger.warn(`Unknown command /${interaction.commandName}`);
          return;
        }

        logger.debug(
          `/${interaction.commandName} by ${interaction.user.username} (${interaction.user.id}) in ${interaction.guildId ?? 'DM'}`,
        );

        if (cooldownMs > 0 && COOLDOWN_COMMANDS.has(interaction.commandName)) {
          const now = Date.now();
          const last = cooldowns.get(interaction.user.id) ?? 0;
          const remaining = last + cooldownMs - now;
          if (remaining > 0) {
            await interaction.reply({
              content: `Slow down — try again in ${Math.ceil(remaining / 1000)}s.`,
              flags: MessageFlags.Ephemeral,
            });
            return;
          }
          cooldowns.set(interaction.user.id, now);
          if (cooldowns.size > 1000) {
            for (const [userId, at] of cooldowns) {
              if (now - at > cooldownMs) cooldowns.delete(userId);
            }
          }
        }

        await command.execute(interaction, ctx);
        return;
      }

      if (interaction.isButton()) {
        await handleButton(interaction, ctx);
        return;
      }

      if (interaction.isStringSelectMenu()) {
        await handleSelect(interaction, ctx);
      }
    } catch (error) {
      await handleInteractionError(interaction, error, ctx);
    }
  });

  client.on(Events.Error, (error) => logger.error('Discord client error', error));
  client.on(Events.Warn, (message) => logger.debug(`Discord warning: ${message}`));
  client.on(Events.GuildCreate, (guild) => logger.info(`Joined server: ${guild.name} (${guild.id})`));
  client.on(Events.VoiceStateUpdate, (oldState, newState) => {
    const guildId = newState.guild?.id ?? oldState.guild?.id;
    if (guildId) manager.handleVoiceStateUpdate(guildId, oldState, newState);
  });
  client.on(Events.GuildDelete, async (guild) => {
    const player = manager.get(guild.id);
    if (player) await player.destroy({ silent: true });
    logger.info(`Left server: ${guild.name ?? guild.id} (${guild.id})`);
  });

  await client.login(config.token);
  return { client, manager, cache };
}

/**
 * @param {import('discord.js').Interaction} interaction
 * @param {unknown} error
 * @param {{ config: ReturnType<typeof import('./config.js').loadConfig>, logger: ReturnType<typeof import('./logger.js').createLogger> }} ctx
 */
async function handleInteractionError(interaction, error, ctx) {
  const isUserError = error instanceof UserError;
  const message = isUserError
    ? error.message
    : 'Something went wrong while handling that. The bot logs have the details.';

  if (isUserError) {
    ctx.logger.debug(
      `User error in ${interaction.isChatInputCommand() ? `/${interaction.commandName}` : interaction.type}: ${error.message}`,
    );
  } else {
    ctx.logger.error(
      `Interaction failed (${interaction.isChatInputCommand() ? `/${interaction.commandName}` : interaction.type})`,
      error,
    );
  }

  if (!interaction.isRepliable()) return;

  const embed = errorEmbed(ctx.config, message);
  try {
    if (interaction.deferred && !interaction.replied) {
      await interaction.editReply({ content: null, embeds: [embed] });
    } else if (interaction.replied) {
      await interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral });
    } else {
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
  } catch (replyError) {
    ctx.logger.warn('Could not send interaction error response', replyError);
  }
}
