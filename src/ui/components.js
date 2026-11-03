import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} from 'discord.js';
import { searchSelectOptions } from './embeds.js';

/**
 * Discord's builder generics are awkward to express through JSDoc, so these
 * helpers deliberately return loose component arrays; the call sites only pass
 * them straight to discord.js.
 *
 * @param {number} page
 * @param {number} totalPages
 * @param {string} userId
 * @returns {any[]}
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
 * @returns {any[]}
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
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`np:previous:${suffix}`)
        .setLabel('Previous')
        .setEmoji('⏮️')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`np:replay:${suffix}`)
        .setLabel('Replay')
        .setEmoji('🔄')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`np:loop:${suffix}`)
        .setLabel('Loop')
        .setEmoji('🔁')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`np:queue:${suffix}`)
        .setLabel('Queue')
        .setEmoji('📋')
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

/**
 * @param {string} token
 * @param {import('../music/youtube.js').Track[]} tracks
 * @returns {any[]}
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

/**
 * @param {string} token
 * @returns {any[]}
 */
export function searchCancelButton(token) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`search:cancel:${token}`)
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}
