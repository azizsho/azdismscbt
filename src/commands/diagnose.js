import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { diagnosticsEmbed } from '../ui/embeds.js';
import { runDiagnostics } from '../services/diagnostics.js';

export default {
  data: new SlashCommandBuilder()
    .setName('diagnose')
    .setDescription('Check the bot, ffmpeg, yt-dlp, YouTube, and cache status.')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @param {{
   *   config: ReturnType<typeof import('../config.js').loadConfig>,
   *   cache: import('../music/cache.js').MediaCache,
   *   logger: ReturnType<typeof import('../logger.js').createLogger>,
   * }} ctx
   */
  async execute(interaction, ctx) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const checks = await runDiagnostics(ctx.config, ctx.cache, ctx.logger);
    await interaction.editReply({ embeds: [diagnosticsEmbed(ctx.config, checks)] });
  },
};
