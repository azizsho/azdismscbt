import { PermissionFlagsBits } from 'discord.js';
import { UserError } from '../util/errors.js';
import { requireVoice } from '../util/checks.js';

/** @param {import('discord.js').RepliableInteraction} interaction */
export function requesterFrom(interaction) {
  const member = interaction.member;
  const displayName =
    member && 'displayName' in member && member.displayName
      ? member.displayName
      : (interaction.user.globalName ?? interaction.user.username);
  return {
    id: interaction.user.id,
    username: interaction.user.username,
    displayName,
  };
}

/**
 * @param {import('../music/youtube.js').Track} track
 * @param {ReturnType<typeof import('../config.js').loadConfig>} config
 */
export function ensurePlayable(track, config) {
  if (track.isLive) {
    throw new UserError('Live streams are not supported. Pick a regular video or song.');
  }
  if (track.durationSec !== null && track.durationSec > config.maxTrackSeconds) {
    throw new UserError(
      `That track is ${Math.ceil(track.durationSec / 60)} minutes long; the limit is ${Math.round(
        config.maxTrackSeconds / 60,
      )} minutes.`,
    );
  }
}

/**
 * Replace a deferred reply with a short status line while work is in progress.
 * Final replies must pass `content: null` so this text is cleared.
 *
 * @param {import('discord.js').RepliableInteraction} interaction
 * @param {string} text
 */
export async function setLoading(interaction, text) {
  try {
    await interaction.editReply({ content: text, embeds: [], components: [] });
  } catch (error) {
    // The user may have deleted the reply before it was edited.
    if (error?.code !== 10008 && error?.status !== 404 && error?.statusCode !== 404) throw error;
  }
}

/**
 * Resolve the voice + text channels and return a connected player.
 *
 * @param {import('discord.js').RepliableInteraction} interaction
 * @param {{ config: ReturnType<typeof import('../config.js').loadConfig>, music: import('../music/manager.js').MusicManager }} ctx
 */
export async function getOrCreatePlayer(interaction, ctx) {
  const voiceChannel = requireVoice(interaction);
  if (!interaction.guild) throw new UserError('This command only works in a server.');
  const channel = interaction.channel;
  if (!channel?.isTextBased()) {
    throw new UserError('Use this command in a text channel.');
  }
  const me = interaction.guild.members.me;
  const permissions = 'permissionsFor' in channel && me ? channel.permissionsFor(me) : null;
  if (
    !permissions?.has(PermissionFlagsBits.SendMessages) ||
    !permissions.has(PermissionFlagsBits.EmbedLinks)
  ) {
    throw new UserError('I need **Send Messages** and **Embed Links** in this channel.');
  }
  const textChannel = /** @type {import('discord.js').GuildTextBasedChannel} */ (channel);
  const player = await ctx.music.getOrCreate(interaction.guild, voiceChannel, textChannel);
  player.setTextChannel(textChannel);
  return player;
}
