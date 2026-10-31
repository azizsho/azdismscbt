const LEVELS = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

const SECRET_KEYS = new Set([
  'token',
  'password',
  'secret',
  'cookie',
  'cookies',
  'authorization',
]);

function redact(value, depth = 0) {
  if (depth > 4 || value === null || value === undefined) return value;
  if (typeof value === 'string') {
    if (value.length > 500) return `${value.slice(0, 500)}…`;
    return value;
  }
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => redact(item, depth + 1));

  const output = {};
  for (const [key, child] of Object.entries(value)) {
    output[key] = SECRET_KEYS.has(key.toLowerCase()) ? '[redacted]' : redact(child, depth + 1);
  }
  return output;
}

function serializeMeta(meta) {
  if (meta === undefined) return '';
  if (meta instanceof Error) {
    return `\n${meta.stack || meta.message}`;
  }
  try {
    const clean = redact(meta);
    if (typeof clean === 'object' && clean !== null && Object.keys(clean).length === 0) return '';
    return ` ${JSON.stringify(clean)}`;
  } catch {
    return '';
  }
}

/**
 * Minimal dependency-free logger. Logs to stdout/stderr so Windows service
 * wrappers (NSSM, systemd, Docker) can capture them.
 *
 * @param {string} level
 * @param {string} [scope]
 */
export function createLogger(level = 'info', scope = 'bot') {
  const threshold = LEVELS[level] ?? LEVELS.info;

  const write = (levelName, message, meta) => {
    if (LEVELS[levelName] < threshold) return;
    const timestamp = new Date().toISOString();
    const line = `${timestamp} ${levelName.toUpperCase().padEnd(5)} [${scope}] ${message}${serializeMeta(meta)}`;
    if (levelName === 'error' || levelName === 'warn') {
      process.stderr.write(`${line}\n`);
    } else {
      process.stdout.write(`${line}\n`);
    }
  };

  return {
    debug: (message, meta) => write('debug', message, meta),
    info: (message, meta) => write('info', message, meta),
    warn: (message, meta) => write('warn', message, meta),
    error: (message, meta) => write('error', message, meta),
    child: (childScope) => createLogger(level, childScope),
    level,
  };
}
