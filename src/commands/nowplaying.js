import { SlashCommandBuilder } from 'discord.js';
import { requirePlayer } from '../util/checks.js';
import { nowPlayingEmbed } from '../ui/embeds.js';
import { nowPlayingButtons } from '../ui/components.js';

export default {
  data: new SlashCommandBuilder()
    .setName('nowplaying')
    .setDescription('Show the track that is currently playing.')
    .setDMPermission(false),

  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @param {{ config: ReturnType<import('../config.js').loadConfig>, music: import('../music/manager.js').MusicManager }} ctx
   */
  async execute(interaction, ctx) {
    const player = requirePlayer(interaction, ctx.music, { requireCurrent: true });
    await interaction.reply({
      embeds: [nowPlayingEmbed(ctx.config, player)],
      components: nowPlayingButtons(interaction.guildId, player.isPaused, player.current.id),
    });
  },
};
