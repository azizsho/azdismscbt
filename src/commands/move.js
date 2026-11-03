import { SlashCommandBuilder } from 'discord.js';
import { requireDJ, requirePlayer } from '../util/checks.js';
import { successEmbed } from '../ui/embeds.js';

export default {
  data: new SlashCommandBuilder()
    .setName('move')
    .setDescription('Move a track to another position in the queue.')
    .setDMPermission(false)
    .addIntegerOption((option) =>
      option.setName('from').setDescription('Current position').setRequired(true).setMinValue(1).setMaxValue(500),
    )
    .addIntegerOption((option) =>
      option.setName('to').setDescription('New position').setRequired(true).setMinValue(1).setMaxValue(500),
    ),

  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @param {{ config: ReturnType<typeof import('../config.js').loadConfig>, music: import('../music/manager.js').MusicManager }} ctx
   */
  async execute(interaction, ctx) {
    const player = requirePlayer(interaction, ctx.music);
    requireDJ(interaction, player);
    const from = interaction.options.getInteger('from', true);
    const to = interaction.options.getInteger('to', true);
    const track = player.queue.move(from, to);
    await interaction.reply({
      embeds: [
        successEmbed(ctx.config, 'Queue updated', `Moved **${track.title}** from position ${from} to ${to}.`),
      ],
    });
  },
};
