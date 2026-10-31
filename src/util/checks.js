import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { UserError, NoVoiceError } from '../util/errors.js';

/**
 * @param {import('discord.js').Interaction} interaction
 * @param {ReturnType<typeof import('../config.js').loadConfig>} config
 */
export function assertAllowedChannel(interaction, config) {
  if (config.allowedTextChannelIds.length === 0) return;
  if (!interaction.channelId || !config.allowedTextChannelIds.includes(interaction.channelId)) {
    throw new UserError('I am not allowed to be used in this channel.');
  }
}

/**
 * Ensure the command was used by a member in a voice channel, and that the bot
 * has permission to join and speak there.
 *
 * @param {import('discord.js').RepliableInteraction} interaction
 * @param {{ requireSameChannel?: boolean, player?: import('../music/guild-player.js').GuildPlayer | null }} [options]
 * @returns {import('discord.js').VoiceChannel}
 */
export function requireVoice(interaction, options = {}) {
  if (!interaction.guild) throw new UserError('This command only works in a server.');
  const member = interaction.member;
  const memberVoice = member && 'voice' in member ? member.voice : null;
  const channel = memberVoice?.channel;
  if (!channel) throw new NoVoiceError();
  if (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice) {
    throw new NoVoiceError('Join a regular voice channel first.');
  }

  if (options.requireSameChannel && options.player) {
    if (options.player.voiceChannelId !== channel.id) {
      throw new UserError(`Join <#${options.player.voiceChannelId}> to control playback.`);
    }
  }

  const me = interaction.guild.members.me;
  if (!me) throw new UserError('I am not fully connected to this server yet. Try again in a moment.');

  const permissions = channel.permissionsFor(me);
  if (!permissions?.has(PermissionFlagsBits.ViewChannel)) {
    throw new UserError('I cannot see that voice channel.');
  }
  if (!permissions.has(PermissionFlagsBits.Connect)) {
    throw new UserError('I need the **Connect** permission for that voice channel.');
  }
  if (!permissions.has(PermissionFlagsBits.Speak)) {
    throw new UserError('I need the **Speak** permission for that voice channel.');
  }

  if (channel.type === ChannelType.GuildStageVoice) {
    // Stage channels require the bot to be a speaker; this is deliberately
    // rejected rather than silently failing.
    throw new UserError('Stage channels are not supported yet. Use a normal voice channel.');
  }

  return /** @type {import('discord.js').VoiceChannel} */ (channel);
}

/**
 * @param {import('discord.js').RepliableInteraction} interaction
 * @param {import('../music/manager.js').MusicManager} music
 * @param {{ requireCurrent?: boolean, requireSameChannel?: boolean }} [options]
 */
export function requirePlayer(interaction, music, options = {}) {
  if (!interaction.guild) throw new UserError('This command only works in a server.');
  const player = music.get(interaction.guild.id);
  if (!player) {
    throw new UserError('Nothing is playing right now. Use `/play` to start some music.');
  }
  if (options.requireCurrent && !player.current) {
    throw new UserError('Nothing is playing right now.');
  }
  if (options.requireSameChannel) {
    const member = interaction.member;
    const memberVoice = member && 'voice' in member ? member.voice : null;
    const channel = memberVoice?.channel;
    if (!channel || channel.id !== player.voiceChannelId) {
      throw new UserError(`Join <#${player.voiceChannelId}> to control playback.`);
    }
  }
  return player;
}

/**
 * @param {import('../music/guild-player.js').GuildPlayer} player
 * @param {import('discord.js').RepliableInteraction} interaction
 */
export function requireDJ(interaction, player) {
  if (!player.isDJ(interaction.member, interaction.memberPermissions)) {
    throw new UserError('You need the DJ role (or Manage Server) to use that control.');
  }
}


