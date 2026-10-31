import { SlashCommandBuilder } from 'discord.js';
import { requireDJ, requirePlayer } from '../util/checks.js';
import { successEmbed } from '../ui/embeds.js';

export default {
  data: new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Stop playback, clear the queue, and leave the voice channel.')
    .setDMPermission(false),

  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @param {{ config: ReturnType<import('../config.js').loadConfig>, music: import('../music/manager.js').MusicManager }} ctx
   */
  async execute(interaction, ctx) {
    const player = requirePlayer(interaction, ctx.music);
    requireDJ(interaction, player);
    await interaction.reply({
      embeds: [successEmbed(ctx.config, 'Stopped', 'Playback stopped and the queue was cleared.')],
    });
    await player.stop();
  },
};
