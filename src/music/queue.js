import { QueueFullError, UserError } from '../util/errors.js';

/**
 * The upcoming-tracks list. The currently playing track is kept separately by
 * GuildPlayer, so positions here are 1-based and refer to the next track.
 */
export class TrackQueue {
  /** @param {number} limit */
  constructor(limit = 100) {
    this.limit = limit;
    /** @type {import('./youtube.js').Track[]} */
    this.tracks = [];
    /** @type {(() => void) | null} */
    this.onChange = null;
  }

  #changed() {
    this.onChange?.();
  }

  get length() {
    return this.tracks.length;
  }

  get isEmpty() {
    return this.tracks.length === 0;
  }

  /** @param {import('./youtube.js').Track} track */
  add(track) {
    if (this.tracks.length >= this.limit) throw new QueueFullError(this.limit);
    this.tracks.push(track);
    this.#changed();
    return this.tracks.length;
  }

  /** @param {import('./youtube.js').Track} track */
  addNext(track) {
    if (this.tracks.length >= this.limit) throw new QueueFullError(this.limit);
    this.tracks.unshift(track);
    this.#changed();
    return 1;
  }

  /** @returns {import('./youtube.js').Track | undefined} */
  shift() {
    const track = this.tracks.shift();
    if (track) this.#changed();
    return track;
  }

  /** @param {number} position 1-based */
  remove(position) {
    this.#assertPosition(position);
    const removed = this.tracks.splice(position - 1, 1)[0];
    this.#changed();
    return removed;
  }

  /**
   * @param {number} from 1-based
   * @param {number} to 1-based
   */
  move(from, to) {
    this.#assertPosition(from);
    this.#assertPosition(to);
    if (from === to) return this.tracks[from - 1];
    const [track] = this.tracks.splice(from - 1, 1);
    this.tracks.splice(to - 1, 0, track);
    this.#changed();
    return track;
  }

  /** @param {number} count */
  skip(count) {
    const removed = this.tracks.splice(0, Math.max(0, count));
    if (removed.length > 0) this.#changed();
    return removed;
  }

  clear() {
    const removed = this.tracks.length;
    this.tracks = [];
    if (removed > 0) this.#changed();
    return removed;
  }

  /** @param {() => number} [random] */
  shuffle(random = Math.random) {
    for (let i = this.tracks.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [this.tracks[i], this.tracks[j]] = [this.tracks[j], this.tracks[i]];
    }
    if (this.tracks.length > 1) this.#changed();
    return this.tracks.length;
  }

  toArray() {
    return [...this.tracks];
  }

  /** @param {number} position 1-based */
  #assertPosition(position) {
    if (!Number.isInteger(position) || position < 1 || position > this.tracks.length) {
      throw new UserError(`Queue position must be between 1 and ${Math.max(1, this.tracks.length)}.`, {
        code: 'BAD_POSITION',
      });
    }
  }
}
