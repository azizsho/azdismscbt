import { SlashCommandBuilder } from 'discord.js';
import { requireDJ, requirePlayer } from '../util/checks.js';
import { UserError } from '../util/errors.js';
import { successEmbed } from '../ui/embeds.js';

export default {
  data: new SlashCommandBuilder()
    .setName('jump')
    .setDescription('Jump directly to a track in the queue.')
    .setDMPermission(false)
    .addIntegerOption((option) =>
      option
        .setName('position')
        .setDescription('Queue position to play (1 = next track)')
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
    if (position > player.queue.length) {
      throw new UserError(`There are only ${player.queue.length} upcoming track(s).`);
    }
    const track = player.queue.tracks[position - 1];
    player.jump(position);
    await interaction.reply({
      embeds: [successEmbed(ctx.config, 'Jumped', `Now playing **${track.title}**.`)],
    });
  },
};
