/** Parse and format timestamps used by /seek and embeds. */

const MAX_SECONDS = 24 * 60 * 60;

/**
 * Parse a user-supplied timestamp.
 *
 * Accepted forms:
 *   - `90`          -> 90 seconds
 *   - `1:30`        -> 1 minute 30 seconds
 *   - `1:02:03`     -> 1 hour 2 minutes 3 seconds
 *   - `1h2m3s`      -> 1 hour 2 minutes 3 seconds
 *
 * @param {string} input
 * @returns {number} whole seconds
 */
export function parseTimestamp(input) {
  if (typeof input !== 'string') {
    throw new Error('Timestamp must be a string.');
  }

  const value = input.trim().toLowerCase().replace(/\s+/g, '');
  if (!value) throw new Error('Timestamp is empty.');

  let seconds = 0;

  if (value.includes(':')) {
    const parts = value.split(':');
    if (parts.length < 2 || parts.length > 3) {
      throw new Error('Use mm:ss or hh:mm:ss.');
    }
    if (parts.some((part) => !/^\d+$/.test(part))) {
      throw new Error('Use only numbers and colons in a timestamp.');
    }

    const numbers = parts.map(Number);
    if (parts.length === 2) {
      const [minutes, secs] = numbers;
      if (secs >= 60) throw new Error('Seconds must be below 60.');
      seconds = minutes * 60 + secs;
    } else {
      const [hours, minutes, secs] = numbers;
      if (minutes >= 60) throw new Error('Minutes must be below 60.');
      if (secs >= 60) throw new Error('Seconds must be below 60.');
      seconds = hours * 3600 + minutes * 60 + secs;
    }
  } else {
    if (/^\d+$/.test(value)) {
      seconds = Number(value);
    } else {
      const match = value.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
      if (!match || !match.slice(1).some(Boolean)) {
        throw new Error('Use a timestamp like 90, 1:30, or 1h2m3s.');
      }
      const [, hours = '0', minutes = '0', secs = '0'] = match;
      seconds = Number(hours) * 3600 + Number(minutes) * 60 + Number(secs);
    }
  }

  if (!Number.isFinite(seconds) || seconds < 0 || seconds > MAX_SECONDS) {
    throw new Error('That timestamp is out of range.');
  }

  return Math.floor(seconds);
}

/**
 * Format seconds as `m:ss` or `h:mm:ss`.
 *
 * @param {number | null | undefined} totalSeconds
 * @param {{ fallback?: string }} [options]
 */
export function formatDuration(totalSeconds, options = {}) {
  const { fallback = '--:--' } = options;
  if (totalSeconds === null || totalSeconds === undefined) return fallback;
  if (!Number.isFinite(totalSeconds)) return fallback;

  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

/**
 * A compact text progress bar.
 *
 * @param {number} positionSeconds
 * @param {number | null | undefined} durationSeconds
 * @param {number} [width]
 */
export function formatProgress(positionSeconds, durationSeconds, width = 18) {
  if (!durationSeconds || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return '`LIVE`';
  }

  const ratio = Math.min(1, Math.max(0, positionSeconds / durationSeconds));
  const filled = Math.min(width, Math.max(0, Math.round(ratio * width)));
  const empty = width - filled;

  let bar;
  if (filled === 0) {
    bar = `●${'─'.repeat(width - 1)}`;
  } else if (filled >= width) {
    bar = `${'━'.repeat(width - 1)}●`;
  } else {
    bar = `${'━'.repeat(filled - 1)}●${'─'.repeat(empty)}`;
  }

  return `\`${bar}\` ${formatDuration(positionSeconds)} / ${formatDuration(durationSeconds)}`;
}

/** Format a millisecond position as a timestamp. */
export function formatMs(milliseconds) {
  return formatDuration(Math.floor((milliseconds ?? 0) / 1000));
}
