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
   * @param {{ config: ReturnType<typeof import('../config.js').loadConfig>, music: import('../music/manager.js').MusicManager }} ctx
   */
  async execute(interaction, ctx) {
    const player = requirePlayer(interaction, ctx.music, { requireCurrent: true });
    const trackId = player.current.id;
    const message = await interaction.reply({
      embeds: [nowPlayingEmbed(ctx.config, player)],
      components: nowPlayingButtons(interaction.guildId, player.isPaused, trackId),
      fetchReply: true,
    });
    // Hand the reply to the player so the progress timer follows this card and
    // the next track removes it instead of leaving a frozen duplicate behind.
    await player.adoptNowPlayingMessage(message, trackId);
  },
};
