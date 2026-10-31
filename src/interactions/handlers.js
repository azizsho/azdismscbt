import { MessageFlags } from 'discord.js';
import { queueEmbed, nowPlayingEmbed, addedEmbed } from '../ui/embeds.js';
import { nowPlayingButtons, queueButtons } from '../ui/components.js';
import { ensurePlayable, requesterFrom } from '../commands/helpers.js';
import { UserError } from '../util/errors.js';

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {{
 *   config: ReturnType<import('../config.js').loadConfig>,
 *   music: import('../music/manager.js').MusicManager,
 * }} ctx
 */
export async function handleButton(interaction, ctx) {
  const parts = interaction.customId.split(':');
  const [kind] = parts;

  if (kind === 'queue' && parts[1] === 'page') {
    const page = Number(parts[2]);
    const userId = parts[3];
    if (userId !== interaction.user.id) {
      throw new UserError('This queue belongs to someone else. Use `/queue` to open your own.');
    }
    const player = ctx.music.require(interaction.guildId);
    const rendered = queueEmbed(ctx.config, player, page);
    await interaction.update({
      embeds: [rendered.embed],
      components: queueButtons(rendered.page, rendered.totalPages, interaction.user.id),
    });
    return;
  }

  if (kind === 'np') {
    const action = parts[1];
    const guildId = parts[2];
    const trackId = parts[3];
    if (interaction.guildId !== guildId) throw new UserError('This control is not for this server.');
    const player = ctx.music.require(guildId);
    const memberChannel = interaction.member?.voice?.channel;
    if (!memberChannel || memberChannel.id !== player.voiceChannelId) {
      throw new UserError(`Join <#${player.voiceChannelId}> to use these controls.`);
    }
    if (!player.current || player.current.id !== trackId) {
      throw new UserError('That control belongs to a track that already finished. Use `/nowplaying`.');
    }
    const currentTrackId = player.current.id;

    if (action === 'toggle') {
      if (player.isPaused) player.resume();
      else player.pause();
      await interaction.update({
        embeds: [nowPlayingEmbed(ctx.config, player)],
        components: nowPlayingButtons(guildId, player.isPaused, currentTrackId),
      });
      return;
    }

    if (action === 'skip') {
      const result = player.skip(1);
      await interaction.reply({
        content: result.skipped ? `Skipped **${result.skipped.title}**.` : 'Skipped.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (action === 'stop') {
      if (!player.isDJ(interaction.member, interaction.memberPermissions)) {
        throw new UserError('You need the DJ role (or Manage Server) to stop playback.');
      }
      await interaction.reply({ content: 'Stopped playback and left the voice channel.', flags: MessageFlags.Ephemeral });
      await player.destroy();
      return;
    }
  }

  throw new UserError('This control has expired. Use `/nowplaying` or `/queue` again.');
}

/**
 * @param {import('discord.js').StringSelectMenuInteraction} interaction
 * @param {{
 *   config: ReturnType<import('../config.js').loadConfig>,
 *   music: import('../music/manager.js').MusicManager,
 * }} ctx
 * }}
 */
export async function handleSelect(interaction, ctx) {
  const [kind, token] = interaction.customId.split(':');
  if (kind !== 'search' || !token) {
    throw new UserError('This search menu has expired. Run `/search` again.');
  }

  const { takeSearchSession } = await import('../services/search-store.js');
  const session = takeSearchSession(token, {
    guildId: interaction.guildId,
    userId: interaction.user.id,
  });
  if (!session) {
    throw new UserError('This search menu has expired or belongs to someone else. Run `/search` again.');
  }

  await interaction.deferUpdate();

  const index = Number(interaction.values[0]);
  const track = session.tracks[index];
  if (!track) throw new UserError('That result is no longer available.');

  const { getOrCreatePlayer } = await import('../commands/helpers.js');
  const player = await getOrCreatePlayer(interaction, ctx);
  ensurePlayable(track, ctx.config);
  track.requester = requesterFrom(interaction);
  const position = player.enqueue(track);

  await interaction.editReply({
    embeds: [addedEmbed(ctx.config, track, { position, queue: player.queue.toArray() })],
    components: [],
  });
}
