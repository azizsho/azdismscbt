import { SlashCommandBuilder } from 'discord.js';
import { helpEmbed } from '../ui/embeds.js';

export default {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show the music commands and quick tips.')
    .setDMPermission(false),

  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @param {{ config: ReturnType<import('../config.js').loadConfig> }} ctx
   */
  async execute(interaction, ctx) {
    await interaction.reply({ embeds: [helpEmbed(ctx.config)] });
  },
};
