import { SlashCommandBuilder } from 'discord.js';
import { requirePlayer } from '../util/checks.js';
import { historyEmbed } from '../ui/embeds.js';

export default {
  data: new SlashCommandBuilder()
    .setName('history')
    .setDescription('Show recently played tracks.')
    .setDMPermission(false),

  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @param {{ config: ReturnType<typeof import('../config.js').loadConfig>, music: import('../music/manager.js').MusicManager }} ctx
   */
  async execute(interaction, ctx) {
    const player = requirePlayer(interaction, ctx.music);
    await interaction.reply({ embeds: [historyEmbed(ctx.config, player.history)] });
  },
};
