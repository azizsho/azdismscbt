import { SlashCommandBuilder } from 'discord.js';
import { requireDJ, requirePlayer } from '../util/checks.js';
import { successEmbed } from '../ui/embeds.js';

export default {
  data: new SlashCommandBuilder()
    .setName('disconnect')
    .setDescription('Disconnect from the voice channel and clear the queue.')
    .setDMPermission(false),

  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @param {{ config: ReturnType<import('../config.js').loadConfig>, music: import('../music/manager.js').MusicManager }} ctx
   */
  async execute(interaction, ctx) {
    const player = requirePlayer(interaction, ctx.music);
    requireDJ(interaction, player);
    await interaction.reply({
      embeds: [successEmbed(ctx.config, 'Disconnected', 'Left the voice channel and cleared the queue.')],
    });
    await player.destroy();
  },
};
