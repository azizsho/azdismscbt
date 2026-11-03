/** Small helpers for safely rendering names in Discord markdown. */

/**
 * Escape characters that would otherwise format a title or username. Brackets
 * are included so plain text cannot accidentally turn into a `[label](url)`
 * markdown link.
 * @param {unknown} value
 */
export function escapeMarkdown(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/([*_~`>|\[\]])/g, '\\$1')
    .replace(/@/g, '@\u200b');
}

/**
 * Truncate to a maximum length, adding an ellipsis when needed.
 * @param {string} value
 * @param {number} max
 */
export function truncate(value, max) {
  const text = String(value ?? '');
  if (text.length <= max) return text;
  if (max <= 1) return '…';
  return `${text.slice(0, max - 1)}…`;
}
