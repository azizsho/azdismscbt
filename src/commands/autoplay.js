import { SlashCommandBuilder } from 'discord.js';
import { requireDJRole } from '../util/checks.js';
import { successEmbed } from '../ui/embeds.js';
import { UserError } from '../util/errors.js';

export default {
  data: new SlashCommandBuilder()
    .setName('autoplay')
    .setDescription('Turn autoplay on or off for this server.')
    .setDMPermission(false)
    .addBooleanOption((option) =>
      option
        .setName('enabled')
        .setDescription('Turn autoplay on or off. Omit to toggle the current setting.'),
    ),

  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @param {{
   *   config: ReturnType<typeof import('../config.js').loadConfig>,
   *   music: import('../music/manager.js').MusicManager,
   * }} ctx
   */
  async execute(interaction, ctx) {
    if (!interaction.guild) throw new UserError('This command only works in a server.');
    requireDJRole(interaction, ctx.config);

    const requested = interaction.options.getBoolean('enabled');
    const enabled = requested ?? !ctx.music.getAutoplay(interaction.guild.id);
    ctx.music.setAutoplay(interaction.guild.id, enabled);

    await interaction.reply({
      embeds: [
        successEmbed(
          ctx.config,
          'Autoplay updated',
          enabled
            ? 'Autoplay is now **on**. When the queue empties, related tracks are queued automatically (loop mode must be off).'
            : 'Autoplay is now **off**. Playback stops when the queue empties.',
        ),
      ],
    });
  },
};
