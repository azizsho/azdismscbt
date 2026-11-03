import play from './play.js';
import search from './search.js';
import skip from './skip.js';
import stop from './stop.js';
import pause from './pause.js';
import resume from './resume.js';
import queue from './queue.js';
import nowplaying from './nowplaying.js';
import remove from './remove.js';
import clear from './clear.js';
import shuffle from './shuffle.js';
import loop from './loop.js';
import autoplay from './autoplay.js';
import seek from './seek.js';
import volume from './volume.js';
import disconnect from './disconnect.js';
import move from './move.js';
import jump from './jump.js';
import history from './history.js';
import help from './help.js';
import diagnose from './diagnose.js';
import status from './status.js';
import cache from './cache.js';

export const commands = [
  play,
  search,
  skip,
  stop,
  pause,
  resume,
  queue,
  nowplaying,
  remove,
  clear,
  shuffle,
  loop,
  autoplay,
  seek,
  volume,
  disconnect,
  move,
  jump,
  history,
  help,
  diagnose,
  status,
  cache,
];

export const commandMap = new Map(commands.map((command) => [command.data.name, command]));

if (commandMap.size !== commands.length) {
  throw new Error('Duplicate slash command name detected.');
}

export function commandPayloads() {
  return commands.map((command) => command.data.toJSON());
}
