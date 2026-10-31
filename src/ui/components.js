import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} from 'discord.js';
import { searchSelectOptions } from './embeds.js';

/**
 * @param {number} page
 * @param {number} totalPages
 * @param {string} userId
 */
export function queueButtons(page, totalPages, userId) {
  if (totalPages <= 1) return [];
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`queue:page:${page - 1}:${userId}`)
        .setLabel('Previous')
        .setEmoji('◀️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page <= 1),
      new ButtonBuilder()
        .setCustomId(`queue:page:${page + 1}:${userId}`)
        .setLabel('Next')
        .setEmoji('▶️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= totalPages),
    ),
  ];
}

/**
 * @param {string} guildId
 * @param {boolean} paused
 * @param {string} trackId
 */
export function nowPlayingButtons(guildId, paused, trackId) {
  const suffix = `${guildId}:${trackId}`;
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`np:toggle:${suffix}`)
        .setLabel(paused ? 'Resume' : 'Pause')
        .setEmoji(paused ? '▶️' : '⏸️')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`np:skip:${suffix}`)
        .setLabel('Skip')
        .setEmoji('⏭️')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`np:stop:${suffix}`)
        .setLabel('Stop')
        .setEmoji('⏹️')
        .setStyle(ButtonStyle.Danger),
    ),
  ];
}

/**
 * @param {string} token
 * @param {import('../music/youtube.js').Track[]} tracks
 */
export function searchSelect(token, tracks) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`search:${token}`)
    .setPlaceholder('Choose a track to add to the queue')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(searchSelectOptions(tracks));

  return [new ActionRowBuilder().addComponents(menu)];
}
