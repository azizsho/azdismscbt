import { SlashCommandBuilder } from 'discord.js';
import { requireDJ, requirePlayer } from '../util/checks.js';
import { UserError } from '../util/errors.js';
import { successEmbed } from '../ui/embeds.js';

export default {
  data: new SlashCommandBuilder()
    .setName('shuffle')
    .setDescription('Shuffle the upcoming queue.')
    .setDMPermission(false),

  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @param {{ config: ReturnType<import('../config.js').loadConfig>, music: import('../music/manager.js').MusicManager }} ctx
   */
  async execute(interaction, ctx) {
    const player = requirePlayer(interaction, ctx.music);
    requireDJ(interaction, player);
    if (player.queue.length < 2) throw new UserError('There are not enough upcoming tracks to shuffle.');
    const count = player.queue.shuffle();
    await interaction.reply({
      embeds: [successEmbed(ctx.config, 'Shuffled', `Shuffled **${count}** upcoming tracks.`)],
    });
  },
};
