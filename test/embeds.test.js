import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
import {
  addedEmbed,
  historyEmbed,
  nowPlayingEmbed,
  playlistAddedEmbed,
  queueBoardEmbed,
  queueEmbed,
  searchEmbed,
} from '../src/ui/embeds.js';

const config = loadConfig(
  {
    DISCORD_TOKEN: 'x'.repeat(30),
    DISCORD_CLIENT_ID: '123456789012345678',
  },
  { checkTools: false },
);

function track(index) {
  return {
    id: `track-${index}`,
    title: `Track ${index} with a fairly long title`,
    url: `https://www.youtube.com/watch?v=track-${index}`,
    durationSec: 60 + index,
    thumbnail: null,
    channel: 'Test Channel',
    isLive: false,
    source: 'youtube',
    requester: { id: 'user-1', username: 'tester', displayName: 'Tester' },
  };
}

function fakePlayer(count) {
  const tracks = Array.from({ length: count }, (_, index) => track(index));
  return {
    current: tracks[0],
    positionMs: 5_000,
    volume: 80,
    loopMode: 'off',
    audioMode: 'Opus 96k',
    isPaused: false,
    queue: {
      length: Math.max(0, count - 1),
      toArray: () => tracks.slice(1),
    },
  };
}

function fields(embed) {
  return embed.data.fields ?? [];
}

function embedText(embed) {
  const data = embed.data;
  return [
    data.title,
    data.description,
    ...fields(embed).flatMap((field) => [field.name, field.value]),
    data.footer?.text,
  ]
    .filter(Boolean)
    .join('\n');
}

function assertNoCardLinks(embed) {
  assert.equal(embed.data.url, undefined);
  assert.doesNotMatch(embedText(embed), /\]\(/);
  assert.doesNotMatch(embedText(embed), /https?:\/\//);
}

test('now-playing embed shows playback fields but no queue preview', () => {
  const embed = nowPlayingEmbed(config, fakePlayer(12));

  assert.deepEqual(
    fields(embed).map((field) => field.name),
    ['Duration', 'Volume', 'Loop', 'Audio'],
  );
  assert.equal(embed.data.url, undefined);
  assert.match(embed.data.footer.text, /11 track\(s\) in queue/);
  assertNoCardLinks(embed);
});

test('now-playing embed handles an empty queue without an up-next field', () => {
  const embed = nowPlayingEmbed(config, fakePlayer(1));

  assert.equal(fields(embed).some((field) => field.name === 'Up next'), false);
  assert.match(embed.data.footer.text, /0 track\(s\) in queue/);
});

test('queue board shows ten tracks and the remaining count', () => {
  const tracks = Array.from({ length: 15 }, (_, index) => track(index));
  const embed = queueBoardEmbed(config, tracks);
  const lines = embed.data.description.split('\n');

  assert.equal(lines.length, 10);
  assert.match(lines[0], /Track 0 with/);
  assert.match(lines[9], /Track 9 with/);
  assert.doesNotMatch(embed.data.description, /Track 10 with/);
  assert.match(embed.data.footer.text, /Showing 10 of 15/);
  assertNoCardLinks(embed);
});

test('queue board shows the whole short queue', () => {
  const embed = queueBoardEmbed(config, [track(0), track(1)]);
  assert.equal(embed.data.description.split('\n').length, 2);
  assert.match(embed.data.footer.text, /2 track\(s\)/);
  assertNoCardLinks(embed);
});

test('added embed includes a capped queue preview', () => {
  const queue = Array.from({ length: 12 }, (_, index) => track(index));
  const embed = addedEmbed(config, track(0), { position: 2, queue });
  const upNext = fields(embed).find((field) => field.name === 'Up next');

  assert.ok(upNext);
  assert.match(embed.data.description, /Track 0 with/);
  assert.match(upNext.value, /…and \*\*2\*\* more/);
  assert.equal(upNext.value.split('\n').length, 11);
  assertNoCardLinks(embed);
});

test('playlist embed includes the queue preview', () => {
  const queue = [track(1), track(2)];
  const embed = playlistAddedEmbed(config, { title: 'Mix', count: 2, queue });
  const upNext = fields(embed).find((field) => field.name === 'Up next');

  assert.ok(upNext);
  assert.match(upNext.value, /Track 1 with/);
  assert.equal(upNext.value.split('\n').length, 2);
  assertNoCardLinks(embed);
});

test('search embed is plain text and points at the dropdown', () => {
  const embed = searchEmbed(config, [track(0), track(1)], 'test song');

  assert.match(embed.data.description, /Track 0 with/);
  assert.match(embed.data.footer.text, /dropdown below/i);
  assertNoCardLinks(embed);
});

test('queue embed renders plain titles for current and upcoming tracks', () => {
  const { embed } = queueEmbed(config, fakePlayer(4), 1);

  assert.match(embed.data.description, /Track 0 with/);
  assert.match(embed.data.description, /Track 1 with/);
  assertNoCardLinks(embed);
});

test('history embed renders plain titles', () => {
  const history = [track(0), track(1)].map((entry) => ({ ...entry, playedAt: Date.now() }));
  const embed = historyEmbed(config, history);

  assert.match(embed.data.description, /Track 0 with/);
  assertNoCardLinks(embed);
});

test('now-playing and search titles escape markdown', () => {
  const tricky = { ...track(0), title: '**bold** _x_ [link](https://example.com)' };
  const player = { ...fakePlayer(1), current: tricky };

  const np = nowPlayingEmbed(config, player);
  assert.ok(np.data.title.includes('\\*\\*bold\\*\\*'));
  assert.ok(np.data.title.includes('\\[link\\]'));
  assert.equal(np.data.title.includes('[link]('), false);
  assert.ok(np.data.title.length <= 256);

  const search = searchEmbed(config, [tricky], '**q** [x](https://example.com)');
  assert.ok(search.data.title.includes('\\*\\*q\\*\\*'));
  assert.equal(search.data.title.includes('[x]('), false);
});
