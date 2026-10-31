import { EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { UserError } from '../util/errors.js';

export default {
  data: new SlashCommandBuilder()
    .setName('cache')
    .setDescription('Show or clear the audio cache.')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((subcommand) =>
      subcommand.setName('stats').setDescription('Show cache usage.'),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('clear')
        .setDescription('Delete cached audio files.')
        .addBooleanOption((option) =>
          option
            .setName('force')
            .setDescription('Clear even while a player has a track or a queue')
            .setRequired(false),
        ),
    ),

  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @param {{
   *   config: ReturnType<typeof import('../config.js').loadConfig>,
   *   music: import('../music/manager.js').MusicManager,
   *   cache: import('../music/cache.js').MediaCache,
   * }} ctx
   */
  async execute(interaction, ctx) {
    const subcommand = interaction.options.getSubcommand();
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (subcommand === 'clear') {
      const force = interaction.options.getBoolean('force') ?? false;
      const active = [...ctx.music.players.values()].some(
        (player) => Boolean(player.current) || player.queue.length > 0,
      );
      if (active && !force) {
        throw new UserError('A player is active right now. Use `/cache clear force:true` if you really want to.');
      }
      await ctx.cache.clear();
    }

    const stats = ctx.cache.getStats();
    const embed = new EmbedBuilder()
      .setColor(ctx.config.embedColor)
      .setTitle('Audio cache')
      .setDescription(
        subcommand === 'clear'
          ? 'Cache cleared.'
          : `${stats.count} file(s) using ${(stats.totalBytes / 1024 / 1024).toFixed(1)} MiB of ${(
              stats.maxBytes /
              1024 /
              1024
            ).toFixed(0)} MiB.`,
      );

    await interaction.editReply({ embeds: [embed] });
  },
};
