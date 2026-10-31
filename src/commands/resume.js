import { SlashCommandBuilder } from 'discord.js';
import { requirePlayer } from '../util/checks.js';
import { successEmbed } from '../ui/embeds.js';

export default {
  data: new SlashCommandBuilder()
    .setName('resume')
    .setDescription('Resume the paused track.')
    .setDMPermission(false),

  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @param {{ config: ReturnType<import('../config.js').loadConfig>, music: import('../music/manager.js').MusicManager }} ctx
   */
  async execute(interaction, ctx) {
    const player = requirePlayer(interaction, ctx.music, {
      requireCurrent: true,
      requireSameChannel: true,
    });
    player.resume();
    await interaction.reply({ embeds: [successEmbed(ctx.config, 'Resumed', 'Playback resumed.')] });
  },
};
