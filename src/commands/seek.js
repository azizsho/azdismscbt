import { SlashCommandBuilder } from 'discord.js';
import { requireDJ, requirePlayer } from '../util/checks.js';
import { UserError } from '../util/errors.js';
import { successEmbed } from '../ui/embeds.js';
import { parseTimestamp, formatDuration } from '../util/time.js';

export default {
  data: new SlashCommandBuilder()
    .setName('seek')
    .setDescription('Jump to a position in the current track.')
    .setDMPermission(false)
    .addStringOption((option) =>
      option
        .setName('position')
        .setDescription('Timestamp such as 1:30 or 2:05:00')
        .setRequired(true)
        .setMaxLength(20),
    ),

  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @param {{ config: ReturnType<import('../config.js').loadConfig>, music: import('../music/manager.js').MusicManager }} ctx
   */
  async execute(interaction, ctx) {
    const player = requirePlayer(interaction, ctx.music, { requireCurrent: true, requireSameChannel: true });
    requireDJ(interaction, player);

    let seconds;
    try {
      seconds = parseTimestamp(interaction.options.getString('position', true));
    } catch (error) {
      throw new UserError(error.message);
    }

    await player.seek(seconds);
    await interaction.reply({
      embeds: [
        successEmbed(ctx.config, 'Seeked', `Jumped to **${formatDuration(seconds)}** in the current track.`),
      ],
    });
  },
};
