import { EmbedBuilder } from 'discord.js';
import { escapeMarkdown, truncate } from '../util/markdown.js';
import { formatDuration, formatProgress } from '../util/time.js';

/** Rows shown on the standalone queue card and the /play confirmation cards. */
export const QUEUE_PREVIEW_LIMIT = 10;

/** @param {import('../music/youtube.js').Track} track */
function previewLine(track, index) {
  return `\`${String(index + 1).padStart(2, ' ')}.\` ${trackTitle(track, 30)} \`${formatDuration(track.durationSec)}\``;
}

/**
 * @param {import('../music/youtube.js').Track[]} tracks
 * @param {number} limit
 */
function previewLines(tracks, limit) {
  return tracks.slice(0, limit).map((track, index) => previewLine(track, index));
}

/**
 * @param {import('../music/youtube.js').Track[]} tracks
 * @param {number} limit
 * @param {{ remainder?: boolean }} [options]
 */
function previewValue(tracks, limit, options = {}) {
  const lines = previewLines(tracks, limit);
  if (options.remainder !== false && tracks.length > limit) {
    lines.push(`…and **${tracks.length - limit}** more — use \`/queue\``);
  }
  return truncate(lines.join('\n'), 1024);
}

/**
 * @param {ReturnType<typeof import('../config.js').loadConfig>} config
 * @param {string} [title]
 */
function baseEmbed(config, title) {
  const embed = new EmbedBuilder().setColor(config.embedColor);
  if (title) embed.setTitle(truncate(title, 256));
  embed.setFooter({ text: 'YouTube Music • high-quality audio' });
  return embed;
}

/**
 * Render a track title as plain text. Cards intentionally avoid clickable
 * links because users mistook linked search results for queue buttons.
 * @param {import('../music/youtube.js').Track} track
 * @param {number} [max]
 */
function trackTitle(track, max = 120) {
  return escapeMarkdown(truncate(track.title, max));
}

/** @param {import('../music/youtube.js').Track} track */
export function requesterName(track) {
  return track.requester?.displayName ?? track.requester?.username ?? 'Unknown';
}

/**
 * @param {ReturnType<typeof import('../config.js').loadConfig>} config
 * @param {import('../music/youtube.js').Track} track
 * @param {{ position?: number, playlist?: string, queue?: import('../music/youtube.js').Track[] }} [options]
 */
export function addedEmbed(config, track, options = {}) {
  const embed = baseEmbed(config, 'Added to queue')
    .setDescription(
      `${trackTitle(track)}\n\`${formatDuration(track.durationSec)}\` • ${escapeMarkdown(track.channel ?? 'Unknown channel')}`,
    )
    .addFields(
      { name: 'Requested by', value: escapeMarkdown(requesterName(track)), inline: true },
      {
        name: 'Position',
        value: options.position === 1 ? 'Next up' : `#${options.position ?? '?'}`,
        inline: true,
      },
    );

  if (options.queue?.length) {
    embed.addFields({ name: 'Up next', value: previewValue(options.queue, QUEUE_PREVIEW_LIMIT) });
  }
  if (track.thumbnail) embed.setThumbnail(track.thumbnail);
  if (options.playlist) embed.setFooter({ text: `From playlist: ${truncate(options.playlist, 100)}` });
  return embed;
}

/**
 * @param {ReturnType<typeof import('../config.js').loadConfig>} config
 * @param {{ title: string, count: number, skipped?: number, queue?: import('../music/youtube.js').Track[] }} playlist
 */
export function playlistAddedEmbed(config, playlist) {
  const skippedText = playlist.skipped ? ` Skipped ${playlist.skipped} unavailable/too-long track(s).` : '';
  const embed = baseEmbed(config, 'Playlist added').setDescription(
    `Queued **${playlist.count}** track(s) from **${escapeMarkdown(truncate(playlist.title, 100))}**.${skippedText}`,
  );
  if (playlist.queue?.length) {
    embed.addFields({ name: 'Up next', value: previewValue(playlist.queue, QUEUE_PREVIEW_LIMIT) });
  }
  return embed;
}

/**
 * A standalone card that follows the now-playing message.
 *
 * @param {ReturnType<typeof import('../config.js').loadConfig>} config
 * @param {import('../music/youtube.js').Track[]} tracks
 */
export function queueBoardEmbed(config, tracks) {
  if (tracks.length === 0) {
    return baseEmbed(config, 'Queue').setDescription('*The queue is empty.*');
  }

  const totalSec = tracks.reduce((sum, track) => sum + (track.durationSec ?? 0), 0);
  const footer =
    tracks.length > QUEUE_PREVIEW_LIMIT
      ? `Showing ${QUEUE_PREVIEW_LIMIT} of ${tracks.length} • ${formatDuration(totalSec)} total • /queue for the full list`
      : `${tracks.length} track(s) • ${formatDuration(totalSec)} total`;

  return baseEmbed(config, 'Queue')
    .setDescription(truncate(previewLines(tracks, QUEUE_PREVIEW_LIMIT).join('\n'), 4000))
    .setFooter({ text: truncate(footer, 2048) });
}

/**
 * @param {ReturnType<typeof import('../config.js').loadConfig>} config
 * @param {import('../music/guild-player.js').GuildPlayer} player
 */
export function nowPlayingEmbed(config, player) {
  const track = player.current;
  if (!track) {
    return baseEmbed(config, 'Nothing playing').setDescription('The queue is empty.');
  }

  const positionMs = player.positionMs;
  const durationSec = track.durationSec;
  const embed = baseEmbed(config, track.title)
    .setDescription(
      `${formatProgress(Math.floor(positionMs / 1000), durationSec)}\n` +
        `${escapeMarkdown(track.channel ?? 'Unknown channel')} • requested by ${escapeMarkdown(requesterName(track))}`,
    )
    .addFields(
      { name: 'Duration', value: `\`${formatDuration(durationSec)}\``, inline: true },
      { name: 'Volume', value: `\`${player.volume}%\``, inline: true },
      { name: 'Loop', value: `\`${player.loopMode}\``, inline: true },
      { name: 'Audio', value: `\`${player.audioMode ?? 'Opus'}\``, inline: true },
    );

  if (track.thumbnail) embed.setThumbnail(track.thumbnail);
  embed.setFooter({
    text: `${player.isPaused ? 'Paused' : 'Playing'} • ${player.queue.length} track(s) in queue`,
  });
  return embed;
}

/**
 * @param {ReturnType<typeof import('../config.js').loadConfig>} config
 * @param {import('../music/guild-player.js').GuildPlayer} player
 * @param {number} page 1-based
 * @param {number} pageSize
 */
export function queueEmbed(config, player, page, pageSize = 10) {
  const tracks = player.queue.toArray();
  const totalPages = Math.max(1, Math.ceil(tracks.length / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;
  const slice = tracks.slice(start, start + pageSize);
  const queueDuration = tracks.reduce((sum, track) => sum + (track.durationSec ?? 0), 0);

  const lines = [];
  if (player.current) {
    lines.push(
      `**Now playing**\n${trackTitle(player.current)} \`${formatDuration(player.current.durationSec)}\`` +
        (player.isPaused ? ' *(paused)*' : ''),
    );
  } else {
    lines.push('**Now playing**\nNothing.');
  }

  lines.push('');
  if (slice.length === 0) {
    lines.push('*The queue is empty.*');
  } else {
    lines.push('**Up next**');
    for (let i = 0; i < slice.length; i++) {
      const track = slice[i];
      const position = start + i + 1;
      lines.push(
        `\`${String(position).padStart(2, ' ')}.\` ${trackTitle(track)} \`${formatDuration(track.durationSec)}\``,
      );
    }
  }

  const embed = baseEmbed(config, 'Music queue')
    .setDescription(truncate(lines.join('\n'), 4000))
    .setFooter({
      text: `Page ${safePage}/${totalPages} • ${tracks.length} upcoming • ${formatDuration(queueDuration)} total`,
    });

  if (player.current?.thumbnail) embed.setThumbnail(player.current.thumbnail);
  return { embed, page: safePage, totalPages };
}

/**
 * @param {ReturnType<typeof import('../config.js').loadConfig>} config
 * @param {import('../music/youtube.js').Track[]} tracks
 * @param {string} query
 */
export function searchEmbed(config, tracks, query) {
  const lines = tracks.slice(0, 8).map((track, index) => {
    return (
      `\`${index + 1}.\` ${trackTitle(track)} \`${formatDuration(track.durationSec)}\`\n` +
      `    ${escapeMarkdown(truncate(track.channel ?? 'Unknown channel', 80))}`
    );
  });

  return baseEmbed(config, `Search results for “${truncate(query, 80)}”`)
    .setDescription(truncate(lines.join('\n') || 'No results.', 4000))
    .setFooter({ text: 'Pick a track from the dropdown below to add it to the queue.' });
}

/**
 * @param {Array<{ id: string, title: string, durationSec: number | null, channel: string | null }>} tracks
 */
export function searchSelectOptions(tracks) {
  return tracks.slice(0, 8).map((track, index) => ({
    label: truncate(`${index + 1}. ${track.title}`, 100),
    description: truncate(
      `${formatDuration(track.durationSec)} • ${track.channel ?? 'Unknown channel'}`,
      100,
    ),
    value: String(index),
  }));
}

/**
 * @param {ReturnType<typeof import('../config.js').loadConfig>} config
 * @param {Array<import('../music/youtube.js').Track & { playedAt: number }>} history
 */
export function historyEmbed(config, history) {
  if (history.length === 0) {
    return baseEmbed(config, 'Play history').setDescription('Nothing has been played yet.');
  }

  const lines = history.slice(0, 15).map((entry, index) => {
    const when = `<t:${Math.floor(entry.playedAt / 1000)}:R>`;
    return `\`${String(index + 1).padStart(2, ' ')}.\` ${trackTitle(entry)} \`${formatDuration(entry.durationSec)}\` • ${when}`;
  });

  return baseEmbed(config, 'Play history').setDescription(truncate(lines.join('\n'), 4000));
}

/**
 * Command names grouped for `/help`. Unknown commands fall into "More", so the
 * help text cannot drift when a command is added.
 */
/** @type {Array<[string, string[]]>} */
const HELP_GROUPS = [
  ['Playback', ['play', 'search', 'pause', 'resume', 'skip', 'stop', 'seek', 'volume', 'loop']],
  ['Queue', ['queue', 'nowplaying', 'remove', 'move', 'jump', 'shuffle', 'clear']],
  ['Other', ['history', 'disconnect', 'help', 'diagnose', 'status', 'cache']],
];

/**
 * @param {ReturnType<typeof import('../config.js').loadConfig>} config
 * @param {Array<{ data: { name: string, description: string } }>} [commands]
 */
export function helpEmbed(config, commands = []) {
  const byName = new Map(commands.map((command) => [command.data.name, command.data.description]));
  const used = new Set();
  const sections = [];

  for (const [label, names] of HELP_GROUPS) {
    const lines = names
      .filter((name) => byName.has(name))
      .map((name) => {
        used.add(name);
        return `\`/${name}\` — ${byName.get(name)}`;
      });
    if (lines.length > 0) sections.push(`**${label}**\n${lines.join('\n')}`);
  }

  const extra = commands
    .filter((command) => !used.has(command.data.name))
    .map((command) => `\`/${command.data.name}\` — ${command.data.description}`);
  if (extra.length > 0) sections.push(`**More**\n${extra.join('\n')}`);

  return baseEmbed(config, 'YouTube Music Bot')
    .setDescription(
      truncate(
        [
          'A self-hosted music bot that streams the best available audio from YouTube.',
          '',
          ...sections,
          '',
          'If a DJ role is configured, destructive controls require that role (or Manage Server).',
        ].join('\n'),
        4000,
      ),
    )
    .setFooter({ text: 'Tip: use a boosted voice channel and set its bitrate for the best quality.' });
}

/**
 * @param {ReturnType<typeof import('../config.js').loadConfig>} config
 * @param {string} description
 */
export function successEmbed(config, title, description) {
  return baseEmbed(config, title).setDescription(truncate(description, 4000));
}

/**
 * @param {ReturnType<typeof import('../config.js').loadConfig>} config
 * @param {string} description
 */
export function errorEmbed(config, description) {
  return new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle('Something went wrong')
    .setDescription(truncate(description, 4000))
    .setFooter({ text: 'Check the bot logs if this keeps happening.' });
}

/**
 * @param {ReturnType<typeof import('../config.js').loadConfig>} config
 * @param {Array<{ name: string, ok: boolean, detail: string }>} checks
 */
export function diagnosticsEmbed(config, checks) {
  const lines = checks.map((check) => `${check.ok ? '✅' : '❌'} **${check.name}** — ${check.detail}`);
  return baseEmbed(config, 'Diagnostics')
    .setDescription(truncate(lines.join('\n'), 4000))
    .setFooter({ text: `Node ${process.version} • ${process.platform}/${process.arch}` });
}
