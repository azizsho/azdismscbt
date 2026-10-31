import { SlashCommandBuilder } from 'discord.js';
import { requireDJ, requirePlayer } from '../util/checks.js';
import { successEmbed } from '../ui/embeds.js';

export default {
  data: new SlashCommandBuilder()
    .setName('loop')
    .setDescription('Set the loop mode.')
    .setDMPermission(false)
    .addStringOption((option) =>
      option
        .setName('mode')
        .setDescription('What to loop')
        .setRequired(true)
        .addChoices(
          { name: 'Off', value: 'off' },
          { name: 'Current track', value: 'track' },
          { name: 'Whole queue', value: 'queue' },
        ),
    ),

  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @param {{ config: ReturnType<typeof import('../config.js').loadConfig>, music: import('../music/manager.js').MusicManager }} ctx
   */
  async execute(interaction, ctx) {
    const player = requirePlayer(interaction, ctx.music);
    requireDJ(interaction, player);
    const mode = interaction.options.getString('mode', true);
    player.setLoop(mode);
    const label = mode === 'off' ? 'Looping is off.' : mode === 'track' ? 'Looping the current track.' : 'Looping the whole queue.';
    await interaction.reply({ embeds: [successEmbed(ctx.config, 'Loop updated', label)] });
  },
};
