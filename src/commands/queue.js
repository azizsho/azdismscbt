import { SlashCommandBuilder } from 'discord.js';
import { requirePlayer } from '../util/checks.js';
import { queueEmbed } from '../ui/embeds.js';
import { queueButtons } from '../ui/components.js';

export default {
  data: new SlashCommandBuilder()
    .setName('queue')
    .setDescription('Show the current queue.')
    .setDMPermission(false)
    .addIntegerOption((option) =>
      option.setName('page').setDescription('Page number').setMinValue(1).setRequired(false),
    ),

  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @param {{ config: ReturnType<import('../config.js').loadConfig>, music: import('../music/manager.js').MusicManager }} ctx
   */
  async execute(interaction, ctx) {
    const player = requirePlayer(interaction, ctx.music);
    const requestedPage = interaction.options.getInteger('page') ?? 1;
    const { embed, page, totalPages } = queueEmbed(ctx.config, player, requestedPage);

    await interaction.reply({
      embeds: [embed],
      components: queueButtons(page, totalPages, interaction.user.id),
    });
  },
};
