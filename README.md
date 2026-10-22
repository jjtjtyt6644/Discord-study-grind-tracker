# GRIND//TRACKER

A study + gaming tracker that runs on your PC and shows your stats **live on your Discord profile**, plus an animated anime-HUD dashboard where you run your study timer.

What your friends see on your profile:

```
Playing  grind tracker
2h 14m studied  ·  1h 30m played
locked in  ▰▰▰▰▰▱▱▱▱▱  52%
00:42:10 elapsed
[ My Steam profile ]
```

## Features

- **Study timer**: start/stop with one click or the <kbd>Space</kbd> key. You can also add minutes you forgot to track.
- **Played today**: pulled from Steam automatically, including the game you're in right now.
- **Steam stats**: profile, level, current game, recently played, games owned, lifetime hours, and achievement progress.
- **Discord Rich Presence**: your profile updates every 15 seconds with study time, play time and a goal progress bar.
- **Daily goal + game budget**: segmented progress bars, a 7-day chart, a streak counter, and confetti when you hit your goal.
- **Dashboard**: moving aurora background, a character panel with mode-reactive tint and speech bubbles, and color themes per mode (purple = studying, red = gaming, blue = on break).

> **Why not the profile "Widgets" board?** Discord only lets officially claimed games (with a Steam store page and a verified dev team) put widgets there. Rich Presence (the "Playing …" card) is the way any personal app can show up on your profile.

---

## Setup

You need **Windows/macOS/Linux**, **[Node.js](https://nodejs.org) 20.12 or newer**, and the **Discord desktop app**. Rich Presence doesn't work in the browser version of Discord.

### 1. Download and install

```bash
git clone https://github.com/jjtjtyt6644/Discord-study-grind-tracker.git
cd Discord-study-grind-tracker
npm install
```

### 2. Create your Discord app (this is what shows on your profile)

1. Open the [Discord Developer Portal](https://discord.com/developers/applications) and click **New Application**.
2. Pick a name. Your profile will say **"Playing &lt;that name&gt;"**, so choose something like `grind tracker` or `locked in`.
3. On **General Information**, copy the **Application ID**.

### 3. Get your Steam details

1. **API key**: go to <https://steamcommunity.com/dev/apikey>, enter any domain (e.g. `localhost`), and copy the key.
2. **SteamID64**: paste your Steam profile link into <https://steamid.io> and copy the 17-digit number (starts with `7656…`).
3. **Make your games visible**: on Steam, go to **Profile → Edit Profile → Privacy Settings** and set **My profile** and **Game details** to **Public**. Otherwise Steam returns no games.

### 4. Fill in `.env`

Copy the example file:

```bash
cp .env.example .env
```

On Windows Command Prompt, use `copy .env.example .env` instead.

Then open `.env` and paste in your values:

```ini
DISCORD_CLIENT_ID=your application id
STEAM_API_KEY=your steam api key
STEAM_ID64=7656119xxxxxxxxxx
LARGE_IMAGE=
PORT=3000
```

`.env` holds your secret keys. It's already in `.gitignore`, so never commit or share it.

### 5. Add your art (optional)

Put two images in `public/img/`:

| File | What it's for | Tips |
| --- | --- | --- |
| `bg.jpg` | The character panel on the right of the dashboard | A tall (portrait) image works best |
| `logo-source.jpg` | Source for your logo | Square, with the face near the center |

Then build the logo:

```bash
npm run logo
```

This creates `public/img/logo.png` (1024×1024, with a neon ring). If the face isn't centered, adjust `crop` in `scripts/make-logo.mjs` and run it again.

No art? The dashboard still works. It just hides the character panel.

### 6. Start it

```bash
npm start
```

Open **<http://localhost:3000>**. Within about 15 seconds your Discord profile shows the activity card. The terminal should say `✓ Discord Rich Presence connected`.

---

## Using it

| Do this | How |
| --- | --- |
| Start / stop studying | Click **Start studying**, or press <kbd>Space</kbd> anywhere on the page |
| Forgot to start the timer | Type the minutes into **"Forgot the timer?"** and press **Add** |
| Change your daily goal or game budget | Click the ⚙ gear (top right) |
| See what your profile shows | Check the **On your profile** card. It mirrors your Discord card |

**Modes** switch automatically:

- **Locked in**: your study timer is running.
- **In game**: Steam says you're playing something.
- **On break**: neither.

Your profile card follows the mode, e.g. `in elden ring  ▰▰▰▱▱▱▱▱▱▱  30%`.

**Keep the app running** while you study and play. If you close it, your Discord activity disappears and play time stops being tracked live. Your study time is saved in `data.json`, and a running timer survives a restart.

### Put your logo on Discord

1. Developer Portal → your app → **General Information → App Icon**: upload `public/img/logo.png`.
2. **Rich Presence → Art Assets**: upload the same file and name it **`logo`**. New assets can take a few minutes to show up.
3. Set `LARGE_IMAGE=logo` in `.env` and restart the app.

`LARGE_IMAGE` can also be a direct `https://` image link. While you're in a game, the card shows that game's banner instead.

---

## Troubleshooting

**Nothing shows on my Discord profile**

- Check that the dashboard's top-right chip says **Discord live**. If it says "Waiting for Discord", open the Discord **desktop** app.
- In Discord, go to **User Settings → Activity Privacy** and turn on **Share your detected activities with others**.
- Your status can't be **Invisible**, because that hides all activity.
- For a specific server: right-click it → **Privacy Settings** → turn on **Activity Status**.
- To see it yourself, click your avatar in the bottom-left corner of Discord.

**The dashboard says "Demo mode"**

The app reads `.env` only when it starts. Restart it (<kbd>Ctrl</kbd>+<kbd>C</kbd>, then `npm start`) after editing `.env`. Also check that all three values are filled in.

**"Played today" is 0 or wrong**

- Your Steam **Game details** must be **Public**.
- The app counts play time from the first time it runs each day, so start it before you play.
- Steam updates its playtime slowly, but the game you're in right now is counted live.

**`EADDRINUSE` / port already in use**

The app is probably already running in another window. Close that one, or set a different `PORT` in `.env`.

**Changed the card text or the app name?**

The "Playing …" name comes from your app's name in the Developer Portal. The two lines under it are built in `presence.js`.

---

## How it works

| File | Job |
| --- | --- |
| `server.js` | Local web server (only reachable from your PC). Tracks study sessions and serves the dashboard and `/api/stats` |
| `steam.js` | Steam Web API calls, cached for 45 seconds. Demo data when no key is set |
| `presence.js` | Builds the Discord activity text and keeps the Rich Presence connection alive |
| `public/` | The dashboard (`index.html`, `style.css`, `app.js`) and your art in `public/img/` |
| `scripts/make-logo.mjs` | Turns `logo-source.jpg` into the round neon logo |
| `data.json` | Your study history (created automatically, not committed) |

Everything runs locally. Your keys and study data never leave your computer, apart from the calls to the Steam API and to your own Discord client.
