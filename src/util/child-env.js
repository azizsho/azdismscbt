/**
 * Build the environment for spawned helper processes (yt-dlp, ffmpeg, and the
 * short-lived commands used by diagnostics/setup).
 *
 * The bot's own process environment includes DISCORD_TOKEN and may include
 * unrelated host secrets. Copying `process.env` into a child hands all of that
 * to the child, so only variables these tools need to start and run are kept.
 *
 * Add entries here when a tool demonstrably needs another non-secret variable;
 * do not fall back to spreading `process.env`.
 */

const ALLOWED_ENV_KEYS = new Set([
  // Cross-platform process basics.
  'path',
  'home',
  'lang',
  'language',
  'lc_all',
  'lc_ctype',
  'lc_messages',
  'tz',
  'temp',
  'tmp',
  'tmpdir',
  'user',
  'logname',
  'shell',
  'xdg_cache_home',
  'xdg_config_home',
  'xdg_data_home',

  // Dynamic loader paths used by distro ffmpeg builds.
  'ld_library_path',
  'dyld_library_path',

  // Outbound HTTPS/proxy settings. These are intentionally user-provided.
  'http_proxy',
  'https_proxy',
  'no_proxy',
  'all_proxy',
  'ssl_cert_file',
  'ssl_cert_dir',
  'requests_ca_bundle',
  'curl_ca_bundle',

  // Windows variables needed by native binaries and Python-free yt-dlp builds.
  'pathext',
  'comspec',
  'systemroot',
  'systemdrive',
  'windir',
  'userprofile',
  'homedrive',
  'homepath',
  'appdata',
  'localappdata',
  'programdata',
  'programfiles',
  'programfiles(x86)',
  'programw6432',
  'commonprogramfiles',
  'commonprogramfiles(x86)',
  'commonprogramw6432',
  'allusersprofile',
  'public',
  'number_of_processors',
  'processor_architecture',
  'processor_identifier',
  'processor_level',
  'processor_revision',
  'os',
  'username',
  'userdomain',
  'logonserver',
  'sessionname',
  'computername',
]);

const IS_WINDOWS = process.platform === 'win32';

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {string} key
 * @param {string} value
 */
function setEnv(env, key, value) {
  // Windows environment names are case-insensitive. Remove an existing entry
  // with different casing so spawn() does not receive two values for one name.
  if (IS_WINDOWS) {
    const lower = key.toLowerCase();
    for (const existing of Object.keys(env)) {
      if (existing.toLowerCase() === lower) delete env[existing];
    }
  }
  env[key] = value;
}

/**
 * Copy only the allowlisted variables from the parent process and apply
 * tool-specific overrides (TEMP/TMP, PYTHONIOENCODING, NO_COLOR, ...).
 *
 * @param {NodeJS.ProcessEnv} [overrides]
 * @returns {NodeJS.ProcessEnv}
 */
export function buildChildEnv(overrides = {}) {
  /** @type {NodeJS.ProcessEnv} */
  const env = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value !== 'string') continue;
    if (ALLOWED_ENV_KEYS.has(key.toLowerCase())) setEnv(env, key, value);
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined || value === null) continue;
    setEnv(env, key, String(value));
  }

  return env;
}
