# Setup checklist

Fill this in on the host PC. **Do not send the bot token or cookie file in chat or commit them to git.**

## 1. Discord application

- [ ] Create an application: <https://discord.com/developers/applications>
- [ ] **Bot → Reset Token** → paste into `DISCORD_TOKEN` in `.env`
- [ ] **General Information → Application ID** → paste into `DISCORD_CLIENT_ID` in `.env`
- [ ] **Server ID** (right-click server → Copy Server ID) → paste into `DISCORD_GUILD_ID` in `.env`
- [ ] Invite the bot:

  ```
  https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=3165200&scope=bot%20applications.commands
  ```

- [ ] Confirm the bot can **View Channel**, **Connect**, and **Speak** in the voice channel
- [ ] Optional: give it **Manage Channels** so it can raise the channel bitrate automatically

## 2. Host PC

- [ ] Node.js **22 LTS or newer**
- [ ] Windows 10/11, Linux, or Docker
- [ ] The PC can stay on while you want music (sleep/hibernate will disconnect it)
- [ ] At least ~2 GB free for the audio cache (configurable)
- [ ] Tell me the OS and whether it is always on

## 3. Audio quality

- [ ] Check the server boost tier: no boost 96 kbps, Tier 1 128, Tier 2 256, Tier 3 384
- [ ] Decide whether the bot may raise the channel bitrate (`AUTO_SET_CHANNEL_BITRATE=true`)
- [ ] `MAX_BITRATE_KBPS=256` is a good default; set `384` only on Tier 3

## 4. Optional

- [ ] DJ role ID(s) → `DJ_ROLE_IDS` (leave empty to let everyone use DJ controls)
- [ ] Dedicated YouTube account cookies → `data/cookies.txt` → `YOUTUBE_COOKIES_FILE=./data/cookies.txt`
      (helps with “confirm you’re not a bot” and age-restricted videos; never use your main account)
- [ ] Restrict commands to certain text channels → `ALLOWED_TEXT_CHANNEL_IDS`

## 5. Run

```powershell
powershell -ExecutionPolicy Bypass -File install.ps1
# edit .env
npm run doctor
npm run deploy
npm start
```

Windows boot task (elevated PowerShell):

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-windows-task.ps1
```

## 6. Send back (no secrets)

- Host OS and whether it is always on
- Server boost tier / desired bitrate
- Any `FAIL` lines from `npm run doctor`
- Any errors from `data/logs/bot.log`
- Whether you want a DJ role or YouTube cookies
