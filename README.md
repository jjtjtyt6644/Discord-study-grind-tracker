# GRIND//TRACKER

A study + gaming tracker that runs on your PC and shows your stats **live on your Discord profile**, plus an animated anime-HUD dashboard where you run your study timer.

What your friends see on your profile:

```
Playing  grind tracker
2h 14m studied  ·  1h 30m played  ·  lv 7
locked in · math  ▰▰▰▰▰▱▱▱▱▱  52%
00:42:10 elapsed
[ My Steam profile ]
```

## Features

- **Study timer**: start/stop with one click or the <kbd>Space</kbd> key. You can also add minutes you forgot to track.
- **Played today**: pulled from Steam automatically, including the game you're in right now.
- **Steam stats**: profile, level, current game, recently played, games owned, lifetime hours, and achievement progress.
- **Discord Rich Presence**: your profile updates every 15 seconds with study time, play time and a goal progress bar.
- **XP, levels & ranks**: earn 1 XP per minute studied, plus a bonus every day you hit your goal. Rank up from Rookie → Apprentice → Scholar → Strategist → Sage → Mastermind → Legend, with a full-screen LEVEL UP animation. Your level shows on your Discord card.
- **Badges**: 11 to unlock, including First Blood, On Fire (3-day streak), Unstoppable (7 days), Marathon (2h session), Night Owl, Early Bird, Goal Crusher, Budget Keeper, Polymath, the Ten-Hour Club and Centurion. Your past history counts too.
- **Subjects**: tag sessions as Math, Coding or your own subjects, and see a breakdown for today and the week. Switching subjects mid-session splits the time correctly. Your current subject shows on Discord (`locked in · math`).
- **Year heatmap**: a GitHub-style grid of every day you studied this year, with totals, active days and your best day.
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

### 2. Add your art (optional)

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

### 3. Start it

```bash
npm start
```

Then open **<http://localhost:3000>** in your browser.

### 4. Connect your accounts (right in the dashboard)

The first time you open the dashboard, a **Connect your accounts** window pops up. Each step has a link straight to the website you need:

| Step | What to paste | Where to get it |
| --- | --- | --- |
| **01 · Discord Application ID** | A 17-20 digit number | [Discord Developer Portal](https://discord.com/developers/applications) → **New Application** → **General Information** → copy **Application ID**. The app's name is what your profile shows after "Playing", so pick something like `grind tracker` or `locked in`. |
| **02 · Steam Web API key** | A 32-character key | [steamcommunity.com/dev/apikey](https://steamcommunity.com/dev/apikey). Type `localhost` as the domain name. |
| **03 · Your Steam profile** | Your profile link **or** SteamID64 | Your profile link works as-is (e.g. `https://steamcommunity.com/id/yourname`). You can also use the 17-digit ID from [steamid.io](https://steamid.io). |

Then click **Save & connect**. Before saving, the app checks with Steam that your key and profile work, and it shows **"Connected as &lt;your name&gt;"** when they do. Discord connects on its own a few seconds later. You don't need to restart.

Also set **Game details** to **Public** in your [Steam privacy settings](https://steamcommunity.com/my/edit/settings), or Steam won't report your play time.

- Want to look around first? Click **Use demo data for now**. You can open the window again any time by clicking the **Discord** chip (top right), the demo-mode banner, or ⚙ → *Edit Discord & Steam connections*.
- **Is typing keys into the page safe?** Yes. The dashboard only runs on your own computer (`localhost`), and the server refuses requests from any other website. Your keys are saved to the `.env` file in the app folder and only ever go to Steam and your own Discord app. The page never shows your Steam key again after you save it.

<details>
<summary>Prefer editing a file? Set the keys in <code>.env</code> instead</summary>

```bash
cp .env.example .env
```

(On Windows Command Prompt, use `copy .env.example .env`.) Then fill it in and restart the app:

```ini
DISCORD_CLIENT_ID=your application id
STEAM_API_KEY=your steam api key
STEAM_ID64=7656119xxxxxxxxxx
LARGE_IMAGE=
PORT=3000
```

`.env` holds your secret keys. It's already in `.gitignore`, so never commit or share it.
</details>

Within about 15 seconds of connecting, your Discord profile shows the activity card, and the top-right chip says **Discord live**.

---

## Using it

| Do this | How |
| --- | --- |
| Start / stop studying | Click **Start studying**, or press <kbd>Space</kbd> anywhere on the page |
| Tag what you're studying | Click a subject chip above the timer (click it again to clear). Add or remove subjects in the **Subjects** card |
| Forgot to start the timer | Type the minutes into **"Forgot the timer?"** and press **Add** |
| Change your daily goal or game budget | Click the ⚙ gear (top right) |
| Change your Discord or Steam keys | Click the **Discord** chip (top right), or ⚙ → *Edit Discord & Steam connections* |
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
3. Open the connections window (click the **Discord** chip), expand **Optional: Discord card image**, type `logo`, and click **Save & connect**. You can also set `LARGE_IMAGE=logo` in `.env`.

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

Click the banner and finish the **Connect your accounts** steps. If you edited `.env` by hand instead, restart the app (<kbd>Ctrl</kbd>+<kbd>C</kbd>, then `npm start`), because `.env` is only read at startup.

**"Steam rejected the API key"**

Copy the key again from <https://steamcommunity.com/dev/apikey>. It's 32 characters, with no spaces.

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
| `progress.js` | XP, levels, ranks and badges, all calculated from your study history |
| `public/` | The dashboard (`index.html`, `style.css`, `app.js`) and your art in `public/img/` |
| `scripts/make-logo.mjs` | Turns `logo-source.jpg` into the round neon logo |
| `data.json` | Your study history (created automatically, not committed) |

Everything runs locally. Your keys and study data never leave your computer, apart from the calls to the Steam API and to your own Discord client.
