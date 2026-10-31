import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { loadConfig } from '../src/config.js';
import { createLogger } from '../src/logger.js';
import { deployCommands } from '../src/deploy.js';

const root = fileURLToPath(new URL('..', import.meta.url));
dotenv.config({ path: path.join(root, '.env'), quiet: true });

try {
  const config = loadConfig(process.env, { checkTools: false });
  const logger = createLogger(config.logLevel, 'deploy');
  await deployCommands(config, logger, { force: process.argv.includes('--force') });
  process.exit(0);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
