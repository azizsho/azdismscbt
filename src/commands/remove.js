import { SlashCommandBuilder } from 'discord.js';
import { requireDJ, requirePlayer } from '../util/checks.js';
import { successEmbed } from '../ui/embeds.js';

export default {
  data: new SlashCommandBuilder()
    .setName('remove')
    .setDescription('Remove an upcoming track from the queue.')
    .setDMPermission(false)
    .addIntegerOption((option) =>
      option
        .setName('position')
        .setDescription('Queue position (1 = next track)')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(500),
    ),

  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @param {{ config: ReturnType<import('../config.js').loadConfig>, music: import('../music/manager.js').MusicManager }} ctx
   */
  async execute(interaction, ctx) {
    const player = requirePlayer(interaction, ctx.music);
    requireDJ(interaction, player);
    const position = interaction.options.getInteger('position', true);
    const removed = player.queue.remove(position);
    await interaction.reply({
      embeds: [successEmbed(ctx.config, 'Removed', `Removed **${removed.title}** from the queue.`)],
    });
  },
};
