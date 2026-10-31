# Discord YouTube Music Bot

A self-hosted Discord music bot that plays **audio only** from YouTube. It uses slash commands for search, queueing, and playback control, and is designed to run unattended on a spare home PC.

Built with:

- **discord.js v14** for slash commands and voice state
- **@discordjs/voice** for the Discord voice connection
- **yt-dlp** for YouTube search, metadata, and audio downloads
- **ffmpeg** for demuxing/remuxing and Opus encoding

> **Audio quality:** YouTube's best audio is usually Opus at ~128–160 kbps (higher with some Premium accounts). When the source is Opus, the bot remuxes it to Ogg and **passes the original packets through** instead of decoding and re-encoding, so there is no generation loss. For non-Opus sources it encodes with libopus at up to 256 kbps. Discord's channel bitrate still caps what listeners can receive; see [Audio quality](#audio-quality).

---

## Features

- `/play` searches YouTube or accepts a video/playlist URL
- `/search` shows a numbered, plain-text result list and a select menu for queueing
- Queue with pagination, remove, move, jump, shuffle, and clear
- Pause, resume, skip, stop, seek, volume, loop (off/track/queue)
- Now-playing embed with pause/skip/stop buttons and live progress refresh; re-posted for every new track
- Queue card below the now-playing embed showing the next 10 tracks; `/queue` shows the full list
- Card titles are plain text (no clickable links); use the menu or buttons to act
- `/play` replies include a snapshot of up to 10 upcoming tracks
- Optional DJ role; anyone can skip
- Automatic voice-channel bitrate boost and restore (if the bot has Manage Channels)
- Optional short join/leave sound clips
- Automatic voice reconnect after a brief network drop
- Audio cache with 3-track-ahead preloading, so the next songs are already on disk
- Auto-disconnect after an idle period
- Works on Windows, Linux, and Docker
- No YouTube API key required

---

## Quick start (Windows)

```powershell
# 1. Install Node.js 22 LTS, then from this folder:
powershell -ExecutionPolicy Bypass -File install.ps1

# 2. Fill in DISCORD_TOKEN and DISCORD_CLIENT_ID in .env, then:
npm run doctor
npm run deploy
npm start
```

For boot-time startup, run the elevated task installer described in [Installation — Windows](#installation--windows-recommended-for-a-home-pc).

---

## What I need from you

These are the only things that cannot be generated automatically:

1. **A Discord bot token and application ID.**
   Create an application at <https://discord.com/developers/applications>, add a bot, then copy:
   - **Application ID** from *General Information*
   - **Bot token** from *Bot → Reset Token*

   **Do not paste the token into chat.** Put it in `.env` on the host. Treat it like a password.

2. **Your Discord server ID.**
   Right-click the server icon → *Copy Server ID* (Developer Mode must be enabled). This is optional but makes slash commands appear instantly while setting up.

3. **A host PC that can stay online.**
   Tell me the OS (Windows 10/11, Linux, etc.), whether it runs 24/7, and whether you can leave a user logged in. The bot does not need a desktop session if you use the Windows boot task or systemd/Docker.

4. **Voice permissions and bitrate.**
   The bot needs **View Channel**, **Connect**, **Speak**, **Send Messages**, and **Embed Links** in the relevant channels. **Manage Channels** is optional but lets it raise the voice bitrate automatically. The server boost tier determines the maximum: no boost 96 kbps, Tier 1 128, Tier 2 256, Tier 3 384.

5. **Optional: YouTube cookies.**
   Recommended if YouTube asks the host to “confirm you’re not a bot”, or if you need age-restricted videos. Export a Netscape-format `cookies.txt` from a **dedicated/throwaway** YouTube account and place it at `data/cookies.txt`. Cookies can expire and may expose the account to YouTube’s terms; keep them private. Do not send cookies in chat.

6. **Optional: a DJ role.**
   Create a role (for example `DJ`), right-click it → *Copy Role ID*, and put the ID in `DJ_ROLE_IDS`. If you leave it empty, everyone can use the destructive controls.

7. **Confirm scope.**
   This build is YouTube-only. Spotify, SoundCloud, lyrics, and recording are intentionally out of scope. Tell me if you want them added.

---

## Discord application setup

1. Go to <https://discord.com/developers/applications> → **New Application**.
2. Open **Bot** → **Reset Token** → copy the token into `DISCORD_TOKEN`.
3. Open **General Information** → copy **Application ID** into `DISCORD_CLIENT_ID`.
4. Invite the bot with this URL (replace `YOUR_CLIENT_ID`):

   ```
   https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=3165200&scope=bot%20applications.commands
   ```

   The permission integer includes View Channel, Send Messages, Embed Links, Connect, Speak, and Manage Channels.

5. **No privileged intents are required.** The bot only uses `Guilds` and `GuildVoiceStates`.

6. For instant command registration, copy your server ID into `DISCORD_GUILD_ID`. Leave it blank to use global commands (Discord can take up to an hour to show them).

---

## Installation — Windows (recommended for a home PC)

### 1. Install Node.js

Install **Node.js 22 LTS or newer** from <https://nodejs.org>. Reopen PowerShell after installing.

```powershell
node --version
```

### 2. Install the bot

From this folder, in PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File install.ps1
```

This runs `npm ci`, downloads ffmpeg through `ffmpeg-static`, downloads yt-dlp into `tools/`, verifies its SHA-256 checksum, and creates `.env`.

If you prefer to do it manually:

```powershell
npm ci
npm run setup
copy .env.example .env
```

### 3. Fill in `.env`

Open `.env` and set at least:

```dotenv
DISCORD_TOKEN=your_real_token
DISCORD_CLIENT_ID=your_application_id
DISCORD_GUILD_ID=your_server_id
```

Then check everything:

```powershell
npm run doctor
```

Fix any `FAIL` lines, register commands, and start:

```powershell
npm run deploy
npm start
```

### 4. Run it at boot (optional but recommended)

Open **PowerShell as Administrator** and run:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-windows-task.ps1
```

This creates a Scheduled Task named `DiscordMusicBot` that:

- starts at boot, before anyone logs in
- runs as `SYSTEM`
- restarts after a crash
- writes logs to `data\logs\bot.log`

Useful commands (Administrator PowerShell):

```powershell
Get-ScheduledTask -TaskName DiscordMusicBot
Start-ScheduledTask -TaskName DiscordMusicBot
Stop-ScheduledTask -TaskName DiscordMusicBot
Get-Content .\data\logs\bot.log -Tail 100 -Wait -Encoding UTF8
```

Remove it with:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/uninstall-windows-task.ps1
```

> The task runs from whichever folder you installed the bot in. If the folder is inside OneDrive or another synced location, pause syncing or move it to a simple local path such as `D:\DiscordMusicBot` so SYSTEM can read it reliably.

---

## Managing the bot

Run these from `D:\DiscordMusicBot`.

### Check whether it is running

```powershell
npm run status
```

Example:

```text
DiscordMusicBot
  Bot:      RUNNING  PID 25728  started 27/10/2026 2:22:56 AM
  Wrapper:  RUNNING  PID 25792
  Folder:   D:\DiscordMusicBot
  Log:      D:\DiscordMusicBot\data\logs\bot.log

Recent log:
...
```

`Bot` is the actual Node process. `Wrapper` is the small PowerShell loop that restarts the bot if it crashes. The helper uses `data\bot.pid` and `data\run.pid`, and verifies the processes actually belong to this bot.

### Start it headless (no window)

```powershell
npm run headless
```

This is how the bot is currently running: it launches `run.ps1` in a hidden window, writes UTF-8 logs to `data\logs\bot.log`, and returns after the bot process is up. It refuses to start a second copy if one is already running.

### Stop it

```powershell
npm run stop
```

This stops the wrapper **first** (so it cannot restart the bot), then the Node process. You can confirm with `npm run status`. Discord will show the bot as offline briefly.

### Restart it

```powershell
npm run restart
```

### Run it in the foreground (for debugging)

```powershell
npm start
```

You see the logs live and can stop it with `Ctrl+C`. Do not use this while the headless copy is running; run `npm run stop` first.

### Follow the log

```powershell
Get-Content .\data\logs\bot.log -Tail 50 -Wait -Encoding UTF8
```

### Headless vs. boot task

- `npm run headless` survives closing the terminal, but **not a reboot**.
- The Windows Scheduled Task starts at boot and survives reboots. Install it from an elevated PowerShell with `npm run service:install`.
- Don’t run the headless copy and the Scheduled Task at the same time. `npm run stop` stops the headless wrapper; use `Stop-ScheduledTask -TaskName DiscordMusicBot` for the task.
---

## Installation — Linux

```bash
# Node.js 22+ and ffmpeg are required.
sudo apt update
sudo apt install -y nodejs npm ffmpeg
# If your distro's Node is older than 22, install Node 22 from NodeSource or nvm.

npm ci
npm run setup

cp .env.example .env
nano .env
npm run doctor
npm run deploy
npm start
```

For systemd, copy the unit and edit the two paths/user:

```bash
sudo cp scripts/discord-music-bot.service /etc/systemd/system/
sudo nano /etc/systemd/system/discord-music-bot.service
sudo systemctl daemon-reload
sudo systemctl enable --now discord-music-bot
sudo journalctl -u discord-music-bot -f
```

`run.sh` is a minimal foreground launcher.

---

## Installation — Docker

Docker is a good option if you want the Node/ffmpeg/yt-dlp stack isolated from the host.

```bash
cp .env.example .env
# Edit .env first.
mkdir -p data
docker compose up -d --build
docker compose logs -f
```

The compose file:

- mounts `./data` into the container (cache, cookies, logs)
- uses `/usr/bin/ffmpeg` from the image
- runs `yt-dlp` from `/usr/local/bin/yt-dlp`
- restarts unless stopped

If you use cookies, put them at `./data/cookies.txt` and set:

```dotenv
YOUTUBE_COOKIES_FILE=/app/data/cookies.txt
```

On Linux, make sure the container user (UID 1000) can write the mounted `data` directory:

```bash
sudo chown -R 1000:1000 data
```

Update the image after a yt-dlp/YouTube breakage:

```bash
docker compose build --pull --no-cache
docker compose up -d
```

---

## Commands

| Command | What it does |
| --- | --- |
| `/play <query> [next] [playlist]` | Search and play the first match, or add a video/playlist URL |
| `/search <query>` | Show a select menu of YouTube results |
| `/skip [count]` | Skip the current track (anyone can use it) |
| `/stop` | Stop, clear the queue, and leave voice |
| `/pause` / `/resume` | Pause or resume |
| `/queue [page]` | Paginated queue with buttons |
| `/nowplaying` | Current track, progress, and controls |
| `/remove <position>` | Remove an upcoming track |
| `/clear` | Clear upcoming tracks |
| `/shuffle` | Shuffle upcoming tracks |
| `/loop <off\|track\|queue>` | Loop mode |
| `/seek <timestamp>` | Jump to `90`, `1:30`, or `1:02:03` |
| `/volume <0-200>` | Set volume (100 = source level) |
| `/move <from> <to>` | Reorder the queue |
| `/jump <position>` | Jump to a queued track |
| `/history` | Recently played tracks |
| `/disconnect` | Leave voice and clear the queue |
| `/help` | In-Discord command list |
| `/diagnose` | Admin-only host/tool/YouTube check |

### DJ behavior

- If `DJ_ROLE_IDS` is empty, **everyone is treated as a DJ**.
- If one or more DJ roles are configured, members with those roles, or **Manage Server**, can use destructive controls such as `/stop`, `/volume`, `/seek`, `/shuffle`, and `/clear`.
- `/skip` is deliberately unrestricted: anyone in the bot’s voice channel can skip one or many tracks.
- `/pause` and `/resume` are available to anyone in the bot’s voice channel.

---

## Audio quality

Discord voice chat is Opus, 48 kHz stereo. The chain is:

```
yt-dlp bestaudio (usually WebM/Opus)
        │
        ├─ Opus source  → ffmpeg -c:a copy → Ogg/Opus → Discord (bit-exact pass-through)
        │
        └─ AAC source   → ffmpeg libopus -b:a Nk → Ogg/Opus → Discord
```

Why this matters:

- Decoding Opus and re-encoding it at a higher bitrate cannot create quality that was not in the source. It only adds generation loss. The bot avoids that by remuxing Opus sources.
- For AAC sources, it encodes at the channel’s target bitrate rather than the 128 kbps default used by many libraries.
- The effective ceiling is the **voice channel bitrate**, which depends on the server boost tier:

| Server tier | Max voice bitrate |
| --- | --- |
| No boosts | 96 kbps |
| Tier 1 | 128 kbps |
| Tier 2 | 256 kbps |
| Tier 3 | 384 kbps |

When `AUTO_SET_CHANNEL_BITRATE=true` (default), the bot sets the channel to `min(tier max, MAX_BITRATE_KBPS)` if it has **Manage Channels**. Set `MAX_BITRATE_KBPS=384` if you have Tier 3 and want the extra headroom. When the bot leaves, it restores the bitrate it changed (unless someone edited the channel in the meantime); set `RESTORE_CHANNEL_BITRATE=false` to keep the boost. If the bot lacks Manage Channels, set the channel bitrate manually in the channel settings.

Notes:

- YouTube’s normal best audio is ~128 kbps Opus. Paying for YouTube Premium does not guarantee a higher-bitrate stream for every video, but Premium cookies can expose better formats when available.
- `AUDIO_NORMALIZE=true` enables single-pass loudness normalization. It is off by default because it forces re-encoding and can slightly colour the audio.
- Live streams are rejected. This bot is for VOD tracks and mixes.

---

## Configuration reference

All settings live in `.env`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `DISCORD_TOKEN` | — | Bot token. Secret. |
| `DISCORD_CLIENT_ID` | — | Application ID for command registration/invite. |
| `DISCORD_GUILD_ID` | empty | Register commands in one server instantly. Empty = global. |
| `DJ_ROLE_IDS` | empty | Comma-separated role IDs for destructive controls. Empty = everyone. |
| `ALLOWED_TEXT_CHANNEL_IDS` | empty | Comma-separated channel IDs where commands are allowed. Empty = anywhere. |
| `DEFAULT_VOLUME` | `80` | 0–200. |
| `MAX_QUEUE_SIZE` | `100` | Upcoming tracks per server. |
| `MAX_TRACK_MINUTES` | `120` | Reject longer videos/mixes. |
| `MAX_PLAYLIST_ITEMS` | `50` | Tracks imported from one playlist URL. |
| `IDLE_DISCONNECT_SECONDS` | `300` | Leave voice after queue is empty. `0` disables. |
| `MAX_BITRATE_KBPS` | `256` | Encoder/channel target, capped by boost tier. |
| `PRELOAD_AHEAD` | `3` | Keep this many upcoming tracks downloaded. `0` disables. |
| `PRELOAD_CONCURRENCY` | `2` | Parallel background downloads (1–4). |
| `AUTO_SET_CHANNEL_BITRATE` | `true` | Raise channel bitrate when permitted. |
| `RESTORE_CHANNEL_BITRATE` | `true` | Restore the original bitrate when leaving, if unchanged. |
| `YTDLP_CONCURRENCY` | `4` | Global cap on concurrent yt-dlp processes (1–16). |
| `COMMAND_COOLDOWN_SECONDS` | `2` | Per-user cooldown for `/play` and `/search`. |
| `YTDLP_MAX_AGE_DAYS` | `45` | Warn at startup when the installed yt-dlp is older. |
| `JOIN_SOUND_FILE` | empty | Optional clip played when joining voice. |
| `LEAVE_SOUND_FILE` | empty | Optional clip played when leaving voice. |
| `SOUND_VOLUME` | `100` | Volume for join/leave clips (0–200). |
| `SOUND_MAX_SECONDS` | `5` | Maximum join/leave clip length (0 disables). |
| `AUDIO_NORMALIZE` | `false` | Single-pass loudness normalization. |
| `AUTO_DEPLOY_COMMANDS` | `true` | Register slash commands at startup if changed. |
| `NOW_PLAYING_MESSAGES` | `true` | Send an embed when a track starts. |
| `YOUTUBE_COOKIES_FILE` | empty | Path to Netscape `cookies.txt`. |
| `AUDIO_CACHE_MAX_MB` | `2048` | Disk cache cap. |
| `DATA_DIR` | `./data` | Cache, cookies, logs, command hash. |
| `FFMPEG_PATH` | bundled | Override ffmpeg binary. |
| `YTDLP_PATH` | `tools/yt-dlp` | Override yt-dlp binary. |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error`, `silent`. |
| `EMBED_COLOR` | `#5865F2` | Embed accent colour. |

### Join/leave sounds

Set `JOIN_SOUND_FILE` and `LEAVE_SOUND_FILE` to short clips (mp3, ogg, wav, or anything ffmpeg can read). The clip temporarily takes over the voice connection, so music pauses while it plays; `SOUND_MAX_SECONDS` caps how long it can hold the bot. Leave clips are skipped during shutdown or when Discord drops the connection, because there is no connection left to play through.

---

## YouTube cookies

YouTube increasingly asks automated clients to prove they are not a bot. A residential home IP usually works without cookies, but if you see:

```
Sign in to confirm you're not a bot
```

do this:

1. Use a **dedicated/throwaway** YouTube account. Do not use your main Google account.
2. In a browser where that account is signed in, install a Netscape cookies exporter (for example “Get cookies.txt LOCALLY”).
3. Export cookies for `youtube.com` and save the file as `data/cookies.txt`.
4. Set:

   ```dotenv
   YOUTUBE_COOKIES_FILE=./data/cookies.txt
   ```

5. Restart the bot.

Cookies expire. If YouTube starts rejecting requests again, re-export the file. Never commit `data/` or share the cookie file; it grants access to that YouTube account.

If cookies are not enough, update yt-dlp:

```powershell
npm run update-tools
```

or on Linux/Docker, rebuild/update the binary.

---

## Troubleshooting

### Is YouTube blocking the bot?

Run `/diagnose` in Discord (Manage Server required). After restarting on the current version it checks two different things:

- **YouTube search** — the lightweight search extractor
- **YouTube playback** — a real `bestaudio` format extraction from a known video, which is where sign-in/captcha/PO-token failures show up

A healthy result looks like:

```
✅ YouTube search — 1 result(s) returned
✅ YouTube playback — extracted dQw4w9WgXcQ|opus
```

When YouTube blocks the host you will usually see one of these in the bot’s error embed or log:

| Symptom | Meaning | Fix |
| --- | --- | --- |
| `YouTube is asking this computer to sign in` | Bot check / captcha / missing cookies | Add `cookies.txt`, or update yt-dlp and retry |
| `YouTube refused the download (403)` | Expired signature or blocked player response | `npm run update-tools`, then cookies if needed |
| `yt-dlp could not extract this video` | YouTube changed its player; yt-dlp is stale | `npm run update-tools` |
| `HTTP Error 429` | Rate limiting | Wait, then retry |
| One specific video fails, others work | Age/region/private/unavailable video | Not a global bot block; try another video |

Manual check from the host:

```powershell
.\tools\yt-dlp.exe --simulate --no-playlist -f "bestaudio[acodec=opus]/bestaudio" --print "%(id)s|%(acodec)s" "https://www.youtube.com/watch?v=VIDEO_ID"
```

If that prints `Sign in to confirm you're not a bot`, YouTube is blocking the host. If it prints an ID and codec, playback extraction is healthy.

The bot now logs failed yt-dlp commands at `WARN` level, including the useful tail of stderr. If you run via `run.ps1` or the boot task, read `data\logs\bot.log`; if you run `npm start` in a terminal, the same lines appear there.

### Where are downloads saved?

Audio downloads are cached in:

```
<project>\data\cache\
```

For this installation that is:

```
D:\DiscordMusicBot\data\cache\
```

Files are named after the YouTube video ID, for example `dQw4w9WgXcQ.webm`. The `.webm` file is audio-only (usually Opus); no video is downloaded. The bot also uses:

| Folder | Contents |
| --- | --- |
| `data\cache\` | Downloaded audio, kept for replay/seek |
| `data\tmp\` | Temporary files for yt-dlp/ffmpeg |
| `data\yt-dlp-cache\` | yt-dlp signature/player caches |
| `data\logs\` | `bot.log` when started by the Windows task/run.ps1 |

The cache is capped at `AUDIO_CACHE_MAX_MB` (default 2048 MB) and evicts the least-recently-used tracks. Cached tracks are not deleted after playback, so the same song starts instantly next time. To change the location or size, set `AUDIO_CACHE_DIR` and `AUDIO_CACHE_MAX_MB` in `.env` and restart. To clear it, stop the bot first and delete the contents of `data\cache`.

### The bot joins but there is no sound

- Confirm the bot has **Connect** and **Speak** in that voice channel.
- Check `npm run doctor`; ffmpeg must include `libopus`.
- Look at `data/logs/bot.log` or the console for `Audio player error` / `ffmpeg exited`.
- Set the channel bitrate manually to 96/128/256/384 depending on boost tier.
- Try `/play` with a normal music video (not a live stream).

### “YouTube is asking this computer to sign in”

Add cookies as described above. If you just updated yt-dlp, wait a few minutes and retry. YouTube changes its challenges frequently; keeping yt-dlp current is the main maintenance task.

### Slash commands do not appear

- Run `npm run deploy`.
- If `DISCORD_GUILD_ID` is set, the bot must already be in that server.
- Global commands can take up to an hour. For setup, use a guild ID.
- Re-invite with the `applications.commands` scope.

### `401 Unauthorized` / login fails

- The token is wrong, reset, or has extra whitespace. Copy it again from *Bot → Reset Token*.
- Do not wrap the token in quotes unless it contains spaces.

### The Windows task starts but the bot is offline

- Open `data\logs\bot.log`.
- Make sure the folder is readable by `SYSTEM` (avoid OneDrive-only folders).
- Run `npm run doctor` as the same user first, then reinstall the task.
- Check `Get-ScheduledTask -TaskName DiscordMusicBot` and `Get-ScheduledTaskInfo`.

### Downloads are slow

- The bot downloads a track once, then caches it. The first play of a track has a delay while yt-dlp downloads; subsequent plays and seeks are local.
- `PRELOAD_AHEAD=3` keeps the next three tracks downloaded while the current one plays, next track first. Increase it to 4–5 on a fast connection if you skip ahead often; set `0` to disable.
- Increase `AUDIO_CACHE_MAX_MB` if you have disk space.
- A slow/limited internet connection is the usual cause.

### yt-dlp broke after a YouTube change

```powershell
npm run update-tools
npm run doctor
```

Restart the bot. The official yt-dlp release is updated frequently; this is normal maintenance for any YouTube bot.

### Docker: permission denied writing `data/`

```bash
sudo chown -R 1000:1000 data
```

The image runs as the `node` user (UID 1000).

---

## Development

```bash
npm install
npm run check     # syntax check
npm test          # unit tests (includes a local ffmpeg/Opus pipeline test)
npm run doctor
```

Optional live YouTube test:

```bash
# PowerShell
$env:RUN_INTEGRATION="1"; node --test test/youtube.integration.test.js
# bash
RUN_INTEGRATION=1 node --test test/youtube.integration.test.js
```

### Project layout

```
src/
  index.js              startup, config, shutdown
  bot.js                Discord client and interaction routing
  config.js             env parsing/validation
  deploy.js             slash command registration + hash cache
  commands/             one file per slash command
  music/
    manager.js          per-guild player registry
    guild-player.js     queue, voice connection, playback state
    youtube.js          yt-dlp search/resolve/download
    cache.js            disk cache + LRU pruning
    audio.js            ffmpeg → Ogg/Opus resource
    queue.js            queue data structure
  interactions/         buttons and search select menu
  services/             search sessions, diagnostics
  ui/                   embeds and components
scripts/                setup, doctor, deploy, Windows task
test/                   node:test suites
```

---

## Security and housekeeping

- `.env`, `data/`, `tools/`, and `node_modules/` are git-ignored.
- Never commit the bot token or `cookies.txt`.
- Use a dedicated YouTube account for cookies.
- Give the bot only the permissions it needs. Manage Channels is optional.
- Keep Node, yt-dlp, and ffmpeg updated. yt-dlp is the component most likely to need updates.
- Respect YouTube’s terms of service and the rights of the content you play. This is a self-hosted tool; you are responsible for how you use it.

---

## Known limitations

- Live YouTube streams are rejected.
- YouTube only. No Spotify, SoundCloud, Apple Music, or local files.
- One bot instance per Discord server; queue state is in memory and is lost on restart.
- No persistent playlists or database.
- Discord’s voice bitrate cap and YouTube’s source bitrate are the real quality ceiling.
- yt-dlp is an external dependency; YouTube changes can break it until it is updated.
