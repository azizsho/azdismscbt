import { SlashCommandBuilder } from 'discord.js';
import { createSearchSession } from '../services/search-store.js';
import { searchEmbed } from '../ui/embeds.js';
import { searchSelect } from '../ui/components.js';
import { UserError } from '../util/errors.js';
import { isYouTubeUrl, looksLikeUrl, normalizeYouTubeInput } from '../util/url.js';
import { requireVoice } from '../util/checks.js';
import { setLoading } from './helpers.js';

export default {
  data: new SlashCommandBuilder()
    .setName('search')
    .setDescription('Search YouTube and choose a track to queue.')
    .setDMPermission(false)
    .addStringOption((option) =>
      option.setName('query').setDescription('What do you want to listen to?').setRequired(true).setMaxLength(200),
    ),

  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @param {{
   *   config: ReturnType<import('../config.js').loadConfig>,
   *   youtube: import('../music/youtube.js').YouTube,
   *   music: import('../music/manager.js').MusicManager,
   * }} ctx
   */
  async execute(interaction, ctx) {
    const query = normalizeYouTubeInput(interaction.options.getString('query', true));
    if (!query) throw new UserError('Type something to search for.');
    if (looksLikeUrl(query) && !isYouTubeUrl(query)) {
      throw new UserError('Only YouTube links are supported. For links, use `/play`.');
    }

    // Make sure the user is actually in a usable voice channel before showing
    // results. The actual connection is created when they pick a track.
    requireVoice(interaction);
    await interaction.deferReply();
    await setLoading(interaction, 'Searching YouTube…');

    const results = await ctx.youtube.search(query, 8);
    const playable = results.filter(
      (track) =>
        !track.isLive &&
        (track.durationSec === null || track.durationSec <= ctx.config.maxTrackSeconds),
    );

    if (playable.length === 0) {
      throw new UserError('No playable results found. Try a different search.');
    }

    const token = createSearchSession({
      guildId: interaction.guildId,
      userId: interaction.user.id,
      query,
      tracks: playable,
    });

    await interaction.editReply({
      content: null,
      embeds: [searchEmbed(ctx.config, playable, query)],
      components: searchSelect(token, playable),
    });
  },
};
