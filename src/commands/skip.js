import { SlashCommandBuilder } from 'discord.js';
import { requirePlayer } from '../util/checks.js';
import { UserError } from '../util/errors.js';
import { successEmbed } from '../ui/embeds.js';

export default {
  data: new SlashCommandBuilder()
    .setName('skip')
    .setDescription('Skip the current track.')
    .setDMPermission(false)
    .addIntegerOption((option) =>
      option
        .setName('count')
        .setDescription('How many tracks to skip')
        .setMinValue(1)
        .setMaxValue(10)
        .setRequired(false),
    ),

  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @param {{ config: ReturnType<import('../config.js').loadConfig>, music: import('../music/manager.js').MusicManager }} ctx
   */
  async execute(interaction, ctx) {
    const player = requirePlayer(interaction, ctx.music, { requireSameChannel: true });
    const count = interaction.options.getInteger('count') ?? 1;

    if (!player.current && player.queue.isEmpty) {
      throw new UserError('Nothing is playing right now.');
    }

    const result = player.skip(count);
    const title = result.skipped?.title ?? 'the current download';
    const extra = count > 1 ? ` and ${count - 1} upcoming track(s)` : '';
    await interaction.reply({
      embeds: [successEmbed(ctx.config, 'Skipped', `Skipped **${title}**${extra}.`)],
    });
  },
};
