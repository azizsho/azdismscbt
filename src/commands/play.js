import { SlashCommandBuilder } from 'discord.js';
import { addedEmbed, playlistAddedEmbed } from '../ui/embeds.js';
import { UserError } from '../util/errors.js';
import { isYouTubeUrl, looksLikeUrl, normalizeYouTubeInput } from '../util/url.js';
import { ensurePlayable, getOrCreatePlayer, requesterFrom, setLoading } from './helpers.js';

export default {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Search YouTube or add a YouTube video/playlist to the queue.')
    .setDMPermission(false)
    .addStringOption((option) =>
      option
        .setName('query')
        .setDescription('Song name, YouTube video URL, or playlist URL')
        .setRequired(true)
        .setMaxLength(500),
    )
    .addBooleanOption((option) =>
      option.setName('next').setDescription('Put this at the front of the queue').setRequired(false),
    )
    .addBooleanOption((option) =>
      option
        .setName('playlist')
        .setDescription('For a video URL that also has a list= parameter, queue the whole playlist')
        .setRequired(false),
    ),

  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @param {{
   *   config: ReturnType<typeof import('../config.js').loadConfig>,
   *   music: import('../music/manager.js').MusicManager,
   *   youtube: import('../music/youtube.js').YouTube,
   * }} ctx
   */
  async execute(interaction, ctx) {
    const query = normalizeYouTubeInput(interaction.options.getString('query', true));
    const next = interaction.options.getBoolean('next') ?? false;
    const playlist = interaction.options.getBoolean('playlist') ?? false;

    if (looksLikeUrl(query) && !isYouTubeUrl(query)) {
      throw new UserError('Only YouTube links are supported.');
    }

    await interaction.deferReply();
    await setLoading(interaction, isYouTubeUrl(query) ? 'Looking up video…' : 'Searching YouTube…');
    const player = await getOrCreatePlayer(interaction, ctx);
    const requester = requesterFrom(interaction);

    if (isYouTubeUrl(query)) {
      const result = await ctx.youtube.resolveUrl(query, { playlist });

      if (result.kind === 'track') {
        ensurePlayable(result.track, ctx.config);
        result.track.requester = requester;
        const position = player.enqueue(result.track, { next });
        await interaction.editReply({
          content: null,
          embeds: [addedEmbed(ctx.config, result.track, { position, queue: player.queue.toArray() })],
        });
        return;
      }

      await setLoading(interaction, 'Loading playlist…');
      const space = ctx.config.maxQueueSize - player.queue.length;
      if (space <= 0) throw new UserError(`The queue is full (${ctx.config.maxQueueSize} tracks).`);

      const tracks = result.tracks.slice(0, space).map((track) => ({
        ...track,
        requester,
        seekOffsetMs: 0,
      }));

      if (next && player.current) {
        for (let i = tracks.length - 1; i >= 0; i--) player.enqueue(tracks[i], { next: true });
      } else {
        // With an idle player the first track becomes "now playing"; queue the
        // rest in playlist order even if the user asked for "next".
        for (const track of tracks) player.enqueue(track);
      }

      await interaction.editReply({
        content: null,
        embeds: [
          playlistAddedEmbed(ctx.config, {
            title: result.title,
            count: tracks.length,
            skippedUnavailable: result.skipped,
            skippedCapacity: Math.max(0, result.tracks.length - tracks.length),
            total: result.total,
            truncated: result.truncated,
            queue: player.queue.toArray(),
          }),
        ],
      });
      return;
    }

    const results = await ctx.youtube.search(query, 8);
    const playable = results.filter(
      (track) =>
        !track.isLive &&
        (track.durationSec === null || track.durationSec <= ctx.config.maxTrackSeconds),
    );

    if (playable.length === 0) {
      throw new UserError('No playable results found. Try a different search or a direct YouTube link.');
    }

    const track = playable[0];
    track.requester = requester;
    const position = player.enqueue(track, { next });
    await interaction.editReply({
      content: null,
      embeds: [addedEmbed(ctx.config, track, { position, queue: player.queue.toArray() })],
    });
  },
};
