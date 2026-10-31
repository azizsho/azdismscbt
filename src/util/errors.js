/**
 * Errors that are safe to show to Discord users.
 *
 * Anything that is not a UserError is treated as an internal error and logged
 * with a generic message shown in Discord.
 */
export class UserError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = 'UserError';
    this.code = options.code ?? 'USER_ERROR';
  }
}

export class QueueFullError extends UserError {
  constructor(limit) {
    super(`The queue is full (maximum ${limit} tracks).`, { code: 'QUEUE_FULL' });
    this.name = 'QueueFullError';
  }
}

export class NoPlayerError extends UserError {
  constructor() {
    super('Nothing is playing right now.', { code: 'NO_PLAYER' });
    this.name = 'NoPlayerError';
  }
}

export class NoVoiceError extends UserError {
  constructor(message = 'Join a voice channel first.') {
    super(message, { code: 'NO_VOICE' });
    this.name = 'NoVoiceError';
  }
}

export function isAbortError(error) {
  return (
    error?.name === 'AbortError' ||
    error?.code === 'ABORT_ERR' ||
    error?.code === 'ERR_CANCELED'
  );
}
