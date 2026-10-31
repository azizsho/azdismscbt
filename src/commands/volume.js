import { SlashCommandBuilder } from 'discord.js';
import { requireDJ, requirePlayer } from '../util/checks.js';
import { successEmbed } from '../ui/embeds.js';

export default {
  data: new SlashCommandBuilder()
    .setName('volume')
    .setDescription('Set the playback volume.')
    .setDMPermission(false)
    .addIntegerOption((option) =>
      option
        .setName('level')
        .setDescription('Volume from 0 to 200 (100 = original)')
        .setRequired(true)
        .setMinValue(0)
        .setMaxValue(200),
    ),

  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @param {{ config: ReturnType<import('../config.js').loadConfig>, music: import('../music/manager.js').MusicManager }} ctx
   */
  async execute(interaction, ctx) {
    const player = requirePlayer(interaction, ctx.music);
    requireDJ(interaction, player);
    const level = interaction.options.getInteger('level', true);
    const changed = await player.setVolume(level);

    if (!changed) {
      await interaction.reply({
        embeds: [successEmbed(ctx.config, 'Volume', `Volume is already **${player.volume}%**.`)],
      });
      return;
    }

    await interaction.reply({
      embeds: [
        successEmbed(
          ctx.config,
          'Volume updated',
          `Volume set to **${player.volume}%**.${
            player.current ? ' The current track was restarted at the same position.' : ''
          }`,
        ),
      ],
    });
  },
};
