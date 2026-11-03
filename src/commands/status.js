import { EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { escapeMarkdown, truncate } from '../util/markdown.js';

export default {
  data: new SlashCommandBuilder()
    .setName('status')
    .setDescription('Show bot, player, cache, and host status.')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @param {{
   *   config: ReturnType<typeof import('../config.js').loadConfig>,
   *   music: import('../music/manager.js').MusicManager,
   *   cache: import('../music/cache.js').MediaCache,
   *   youtube: import('../music/youtube.js').YouTube,
   * }} ctx
   */
  async execute(interaction, ctx) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const player = ctx.music.get(interaction.guildId);
    const cacheStats = ctx.cache.getStats();
    let ytdlp = 'unknown';
    try {
      const info = await ctx.youtube.versionStatus();
      if (info?.version) {
        const age = info.ageDays === null ? '' : ` (${info.ageDays}d old)`;
        ytdlp = `${info.version}${age}${info.stale ? ' — stale' : ''}`;
      }
    } catch {
      // The version check is optional for a status card.
    }

    const fields = [
      { name: 'Uptime', value: `${Math.floor(process.uptime() / 60)} min`, inline: true },
      { name: 'Ping', value: `${Math.round(interaction.client.ws.ping)} ms`, inline: true },
      { name: 'Servers', value: String(interaction.client.guilds.cache.size), inline: true },
      { name: 'Active players', value: String(ctx.music.size), inline: true },
      {
        name: 'Autoplay',
        value: ctx.music.getAutoplay(interaction.guildId ?? '') ? 'on' : 'off',
        inline: true,
      },
      { name: 'Memory', value: `${(process.memoryUsage().rss / 1024 / 1024).toFixed(0)} MiB`, inline: true },
      { name: 'Node', value: process.version, inline: true },
    ];

    if (player) {
      const current = player.current
        ? escapeMarkdown(truncate(player.current.title, 80))
        : 'idle';
      fields.push({
        name: 'This server',
        value: `${current} • ${player.queue.length} queued • volume ${player.volume}% • loop ${player.loopMode}`,
        inline: false,
      });
    }

    fields.push({
      name: 'Cache',
      value: `${cacheStats.count} file(s), ${(cacheStats.totalBytes / 1024 / 1024).toFixed(1)} MiB / ${(
        cacheStats.maxBytes /
        1024 /
        1024
      ).toFixed(0)} MiB`,
      inline: false,
    });
    fields.push({ name: 'yt-dlp', value: ytdlp, inline: false });

    const embed = new EmbedBuilder()
      .setColor(ctx.config.embedColor)
      .setTitle('Bot status')
      .setFields(fields)
      .setFooter({ text: interaction.client.user?.tag ?? 'music bot' });

    await interaction.editReply({ embeds: [embed] });
  },
};
