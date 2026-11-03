import { SlashCommandBuilder } from 'discord.js';
import { requireDJ, requirePlayer } from '../util/checks.js';
import { successEmbed } from '../ui/embeds.js';

export default {
  data: new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Clear all upcoming tracks (the current track keeps playing).')
    .setDMPermission(false),

  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @param {{ config: ReturnType<typeof import('../config.js').loadConfig>, music: import('../music/manager.js').MusicManager }} ctx
   */
  async execute(interaction, ctx) {
    const player = requirePlayer(interaction, ctx.music);
    requireDJ(interaction, player);
    const removed = player.queue.clear();
    await interaction.reply({
      embeds: [
        successEmbed(
          ctx.config,
          'Queue cleared',
          removed > 0 ? `Removed ${removed} upcoming track(s).` : 'The queue was already empty.',
        ),
      ],
    });
  },
};
