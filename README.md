# GRIND//TRACKER

A study + gaming tracker that runs on your PC and shows your stats **live on your Discord profile**, plus an animated anime-HUD dashboard with a study timer, XP and ranks, badges, subjects, Steam stats and a year heatmap.

What your friends see on your profile:

```
Playing  grind tracker
2h 14m studied  ·  1h 30m played  ·  lv 7
locked in · math  ▰▰▰▰▰▱▱▱▱▱  52%
00:42:10 elapsed
[ My Steam profile ]
```

## ⬇ Download (Windows)

**[Get the latest GrindTracker.exe from Releases](https://github.com/jjtjtyt6644/Discord-study-grind-tracker/releases/latest)**. It's one file: no install and no Node.js needed.

1. Put `GrindTracker.exe` somewhere permanent, e.g. a `Grind Tracker` folder in Documents.
2. **Double-click it.** Grind Tracker opens in its own app window (no browser tabs). **Closing the window quits the app.**
3. Follow the **Connect your accounts** window (see [Connect your accounts](#connect-your-accounts)).
4. Optional: ⚙ **Settings → Start with Windows**, so it's always running when you study.

> **"Windows protected your PC"?** The exe isn't code-signed (signing certificates cost money), so SmartScreen warns about new downloads. Click **More info → Run anyway**. Every release is built automatically by GitHub Actions from the source in this repo.

You also need the **Discord desktop app** running. Rich Presence doesn't work in Discord's browser version.

---

## Features

**Tracking**
- **Study timer**: start/stop with one click or <kbd>Space</kbd>. The live time also shows in the browser tab title.
- **Subjects**: tag sessions (Math, Coding, or your own). Pick one with the chips above the timer, a row in the Subjects card, or <kbd>1</kbd>–<kbd>9</kbd>. Switching mid-session splits the time correctly.
- **Fix your time**: **+ Add** time you forgot to track, **− Remove** time you added by mistake, or click any entry in **Today's log** to edit or delete it.
- **Pause**: pause a session and resume it later (<kbd>P</kbd>). The time so far is saved.
- **Auto-start**: pick your study apps (VS Code, Notion, Anki…) in ⚙ Settings → **Auto-start**. Opening one starts the timer with that app's subject, and closing them stops it again.
- **Sessions past midnight** are split at 00:00, so each day gets its own time and today never shows 0h while you're locked in.
- **"Still studying?"**: after 3 hours nonstop, it checks that you didn't forget the timer.
- **Focus timer (Pomodoro)**: switch the Session card to **Focus** for timed rounds (25/5 by default, with a long break every 4). It has a countdown ring, a chime between phases, and keeps running with the window closed. Rounds count as study time. Change the lengths right on the card with the +/− steppers, or pick Classic 25/5, Deep 50/10, Flow 90/15 or Sprint 15/3.
- **Any game, not just Steam**: like Discord, Grind Tracker spots games you open from any launcher (Epic, Riot, Battle.net, emulators…) using Discord's own list of 10,000+ games. Not detected? Add any program in ⚙ Settings → **Games** and give it a name, or press **Not a game** on one that shouldn't count.
- **Played today**: Steam time plus every detected game, without counting the same game twice. The game you're in right now shows under it with its icon and a live timer.
- **Studying or Working**: flip the toggle at the top and the whole app (dashboard, quests, badges, notifications and your Discord card) says "worked" instead of "studied".
- **Session notes**: add a short note to any entry in Today's log ("Chapter 5 problems"). Notes go into the CSV export too.

**Progress**
- **Daily quests**: 3 new missions every day (e.g. "Finish 2 sessions of 45m+", "Complete 2 focus rounds", "Start before 10am"). +50 XP each, +100 for clearing all 3, plus a quest streak.
- **XP, levels & ranks**: 2 XP per minute studied, +100 XP every day you hit your goal, and quest XP on top. **50 levels**: 10 ranks with 5 divisions each (Rookie I → Apprentice → Scholar → Strategist → Sage → Mastermind → Virtuoso → Grandmaster → Mythic → Legend V), with a full-screen LEVEL UP moment. Level 2 takes about 25 minutes; Legend V is the long game.
- **18 badges** across streaks, focus, habits, goals, balance, subjects and total time. Click a badge to see what it's for and how close you are.
- **Year heatmap**: a GitHub-style grid of every day you studied, with totals and your best day.
- **Daily goal + game budget**: segmented progress bars, a 7-day chart, a streak counter, and confetti when you hit your goal. Optionally set a **different goal for weekends**, and a heads-up 15 minutes before your game budget runs out.
- **Weekly subject goals**: e.g. "Math: 5h this week", with a progress bar per subject in the Subjects card.
- **Streak freezes** ❄: every 7 days you hit your goal earns one (hold up to 3). Missing a day spends one automatically, so your streak survives.
- **Weekly report** (<kbd>W</kbd>): last week and this week: total vs the week before, a day-by-day chart, best day, goal days, play time, sessions, focus rounds, quests and top subjects. Also a Monday-morning notification.

**Steam**
- Profile, level, current or last game, recently played, games owned and lifetime hours.
- **Achievements** for any recently played game: completion, your **rarest unlock** (the % of all players who have it), latest unlocks, and the **easiest ones to get next**.

**Discord**
- A **Rich Presence card** that updates every 15s: study and play time, level, current subject or game, a goal bar, and a focus countdown. **In a game, the game is the headline** (with its icon), for Steam and non-Steam games alike.
- **Member list status**: what people see next to your name in a server. By default it's **"Playing Elden Ring · 1h 20m"** in a game and your stats ("Playing 2h 14m studied · …") otherwise. Or just the game's name, or the classic "Playing grind tracker" (⚙ Settings → Privacy).
- **Custom status**: your own line like "cramming for finals". Pick one from the dashboard's Discord card, or manage them in ⚙ Settings → Privacy.
- **Privacy controls**: choose exactly what the card shows (study time, play time, level, subject, game, goal bar, timer, picture, Steam button), with a live preview. Or hide it completely. Everything is on by default.

**App**
- **Auto-updates**: the app checks GitHub for new versions, downloads and verifies them in the background, and asks you to restart. You can turn this off in Settings.
- **Notifications**: Windows notifications for hitting your goal, going over your game budget, focus rounds and breaks, finished quests, a break reminder after long sessions, an optional "no study yet today" nudge, and an optional **daily recap** at a time you pick. Each one can be switched off.
- **Themes & your own art**: Mode colors (default), Sakura, Ocean, Ember, Matcha, Mono, or your own two colors. Upload your own character art and logo straight from Settings.
- **Desktop app**: one `.exe` that opens in its own window. Closing the window quits it and frees the port, unless you turn on **Keep running when I close the window** so Discord keeps showing your stats. Also **Start with Windows** and **Quit** in Settings.
- **Built-in Guide and About pages**, keyboard shortcuts (<kbd>?</kbd>), and **CSV export** of your full history.
- **Dashboard**: aurora background, a character panel (Reze by default) with mode-colored tint and speech bubbles.

> **Why not the profile "Widgets" board?** Discord only lets officially claimed games (with a Steam store page and a verified dev team) put widgets there. Rich Presence, the "Playing …" card, is the way any personal app can show up on your profile.

---

## Connect your accounts

The first time you open the dashboard, a **Connect your accounts** window pops up. Each step links straight to the website you need:

| Step | What to paste | Where to get it |
| --- | --- | --- |
| **01 · Discord Application ID** | A 17-20 digit number | [Discord Developer Portal](https://discord.com/developers/applications) → **New Application** → **General Information** → copy **Application ID**. The app's **name** is what your profile shows after "Playing", so pick something like `grind tracker`. |
| **02 · Steam Web API key** | A 32-character key | [steamcommunity.com/dev/apikey](https://steamcommunity.com/dev/apikey). Type `localhost` as the domain name. |
| **03 · Your Steam profile** | Your profile link **or** SteamID64 | Paste your profile link as-is (e.g. `https://steamcommunity.com/id/yourname`), or the 17-digit ID from [steamid.io](https://steamid.io). |

Click **Save & connect**. The app checks with Steam first and shows **"Connected as &lt;your name&gt;"** when it works. Discord connects a few seconds later, with no restart needed.

Then set **Game details** to **Public** in your [Steam privacy settings](https://steamcommunity.com/my/edit/settings). Without it, Steam hides your achievements.

- Just looking around? Click **Use demo data for now**. Reopen the window any time from the **Discord** chip (top right), or ⚙ → *Edit Discord & Steam connections*.
- **Is typing keys into the page safe?** Yes. The dashboard only runs on your own computer (`localhost`), and the app refuses requests from any other website. Keys are saved to a `.env` file in your data folder and only go to Steam and your own Discord app.

### Put your logo on Discord (optional)

1. Developer Portal → your app → **General Information → App Icon**: upload `logo.png` (in this repo at `public/img/logo.png`).
2. **Rich Presence → Art Assets**: upload the same file and name it **`logo`**. New assets can take a few minutes to appear.
3. In the connections window, expand **Optional: Discord card image**, type `logo`, and click **Save & connect**.

---

## Using it

| Do this | How |
| --- | --- |
| Start / stop studying | **Start studying**, or <kbd>Space</kbd> anywhere on the page |
| Tag what you're studying | A subject chip, a row in the **Subjects** card, or <kbd>1</kbd>–<kbd>9</kbd> (again to clear) |
| Forgot to start the timer | Type minutes under the timer → **+ Add** |
| Added too much time | Type minutes → **− Remove** (newest time first), or click a duration in **Today's log** |
| Delete an entry | **Today's log** → **×** → **Delete?** |
| Change goal / game budget | ⚙ **Settings** (or <kbd>G</kbd>) → **Goals** (weekend goal is there too) |
| Studying or working | The **Studying / Working** toggle at the top of the dashboard |
| Pause | **Pause** next to End session, or <kbd>P</kbd>. **Resume** (or <kbd>Space</kbd>) to continue |
| Start the timer when you open an app | ⚙ **Settings → Auto-start** → pick the running app, name it, choose a subject, **Add** |
| Set a weekly goal for a subject | ⚙ **Settings → Goals → Weekly subject goals** |
| Set your Discord status line | **Status** under the Discord card on the dashboard |
| See how your week went | **Weekly report →** on the Last 7 days card, or <kbd>W</kbd> |
| Add a note to a session | **Today's log** → **+ note** (✎ to change it) |
| A game isn't detected | ⚙ **Settings → Games** → pick it from *Choose a running program* (open apps are listed first, and you can type to search), name it, **Add** |
| Use the focus timer | Switch the Session card to **Focus**, then **Start focus** (or <kbd>Space</kbd>) |
| Choose what Discord shows | ⚙ **Settings → Privacy** |
| Settings | ⚙ (top right) or <kbd>G</kbd>: **Goals**, **Focus timer**, **Privacy**, **Notifications**, **Appearance**, **Games**, **Auto-start**, **App**, **Updates**, **Connections**, **Data & backups**, **Shortcuts**. Everything saves instantly |
| Update | Automatic: click **Restart now** on the banner when one is ready. Or ⚙ **Settings → Check for updates** |
| Back up your history | **Export CSV** in Today's log, or ⚙ → *Download my study history* |
| Learn everything | **Guide** at the top of the dashboard, or <kbd>?</kbd> for shortcuts |

**Modes** switch automatically: **Locked in** (timer running), **In game** (a Steam game or any detected game is running), and **On break** (neither). Your Discord card follows along.

### Your data

| | Desktop app (`.exe`) | Running from source |
| --- | --- | --- |
| Study history, settings | `%APPDATA%\GrindTracker\data.json` | `data.json` in the project folder |
| Your keys | `%APPDATA%\GrindTracker\.env` | `.env` in the project folder |
| Log | `%APPDATA%\GrindTracker\grind-tracker.log` | the terminal |
| Custom art | ⚙ **Settings → Appearance → Upload**, then drag and zoom to crop it (stored in `%APPDATA%\GrindTracker\img\`) | same, stored in `img/` in the project folder |

Open the folder from ⚙ **Settings → Data & backups**, or paste `%APPDATA%\GrindTracker` into File Explorer.

**Your history is protected:**
- Saves are atomic (written to a temp file, then swapped in), so a crash or power cut can't leave a half-written file.
- A backup is made every day and right before every update, in `backups\`. Only the newest 3 are kept; older ones are deleted automatically to save space.
- Badges are saved the moment you earn them, so editing time or changing your goal never takes one away.
- If `data.json` is ever missing or damaged, the newest backup is restored automatically. A damaged file is set aside, never deleted.

**Updates install themselves.** The app checks GitHub 5 seconds after it starts, every 30 minutes, and whenever you open the window. A new version downloads in the background (with progress in the banner), is checked against the SHA-256 GitHub publishes, and is swapped in. If the window is open you get **Restart now**; if it's closed, the app switches over on its own. Updates only replace the exe, never your data folder. If the exe sits somewhere it can't write to (like Program Files), you get a download link instead.

Moving from source to the exe? Copy your `data.json` and `.env` into `%APPDATA%\GrindTracker`.

---

## Troubleshooting

**Nothing shows on my Discord profile**
- The dashboard's top-right chip should say **Discord live**. "Waiting for Discord" means the Discord **desktop** app isn't open.
- Discord → **User Settings → Activity Privacy** → turn on **Share your detected activities with others**.
- Your status can't be **Invisible**.
- For a specific server: right-click it → **Privacy Settings** → **Activity Status** on.

**Achievements say "Your achievements are hidden"**: set **Game details** to **Public** in [Steam privacy settings](https://steamcommunity.com/my/edit/settings) and wait a few minutes. Your play time works either way, because Steam always shows your library to your own key.

**Today's total looks wrong**: use **− Remove**, or edit or delete entries in **Today's log**. Time added before the log existed shows as **"+ added earlier"**. There are no limits on how much you add; if a day would go past 24 hours, it asks you to confirm first (usually that means a typo).

**"Steam rejected the API key"**: copy it again from [steamcommunity.com/dev/apikey](https://steamcommunity.com/dev/apikey). It's exactly 32 characters.

**"Played today" is 0**: Grind Tracker counts play time from its first run each day. Turn on **Start with Windows** so it's always running.

**Discord card disappears when I close the window**: that's the default, because closing the window quits the app. Turn on ⚙ **Settings → Keep running when I close the window** to keep it going; reopen the window by launching the exe again.

**Double-clicked the exe and nothing new started**: it's already running, so it just opens its window again.

**Port 3000 is taken by another program**: the app tells you which program it is and asks whether to close it. Choose **No** and it uses the next free port (3001, 3002, … up to 3020) instead; opening the exe again still finds it. To pick the starting port yourself, add `PORT=3100` to your `.env`.

---

## Run from source / build it yourself

You need [Node.js](https://nodejs.org) 22 or newer.

```bash
git clone https://github.com/jjtjtyt6644/Discord-study-grind-tracker.git
cd Discord-study-grind-tracker
npm install
npm start
```

Then open <http://localhost:3000>.

| Command | What it does |
| --- | --- |
| `npm start` | Runs the app from source |
| `npm run logo` | Rebuilds `public/img/logo.png` + `logo-small.png` from `public/img/logo-source.jpg` (adjust `crop` in `scripts/make-logo.mjs`) |
| `npm run build:exe` | Builds `dist/GrindTracker.exe` on Windows: bundles the app, packs it into a [Node single executable](https://nodejs.org/api/single-executable-applications.html), sets the icon, and hides the console window |

### Publishing a release

Releases are built by GitHub Actions (`.github/workflows/release.yml`):

1. Bump `"version"` in `package.json` and commit. Installed apps compare against this, so a higher version is what triggers their auto-update.
2. Tag and push:

   ```bash
   git tag v1.0.1
   git push origin v1.0.1
   ```

3. Actions builds the exe on Windows and creates the release with `GrindTracker.exe` attached. That takes about 3 minutes. You can watch it under the repo's **Actions** tab. Within about 30 minutes (or as soon as they open the app), everyone's copy picks up the update.

### How it works

| File | Job |
| --- | --- |
| `server.js` | Local web server (only reachable from your PC): study sessions, subjects, log, settings, and the `/api/*` the dashboard uses |
| `desktop.js` | What's different in the exe: data folder, the app window (Edge/Chrome app mode), Start with Windows, log file |
| `updater.js` | Checks GitHub Releases, streams + verifies the new exe, swaps it in, and restarts |
| `store.js` | Saves study data atomically, keeps daily + pre-update backups, restores from backup if the file is damaged |
| `steam.js` | Steam Web API: profile, play time, achievements and global rarity. Demo data when not connected |
| `presence.js` | Builds the Discord card text and keeps the Rich Presence connection alive |
| `progress.js` | XP, levels, ranks, badges and streak freezes, all calculated from your study history |
| `focus.js` | The focus (Pomodoro) timer: phases, rounds, auto-next |
| `quests.js` | Daily quests: picking 3 per day, progress, quest XP and streak |
| `notify.js` | Windows notifications and reminders (goal, budget heads-up, break, nudge, daily recap, weekly report) |
| `games.js` | Game detection: Discord's public list of games (cached weekly) matched against running programs, plus your own programs |
| `vocab.js` | Studying/Working wording for the Discord card, quests, badges and notifications |
| `public/` | Dashboard (`index.html`, `app.js`, themed dropdowns in `select.js`), Guide/About (`guide.html`, `about.html`, `pages.js`), background (`bg.js`), styles, and art |
| `scripts/` | `make-logo.mjs` and `build-exe.mjs` |

Everything runs locally. Your keys and study data never leave your computer, apart from the calls to the Steam API and to your own Discord app.

## Credits

Built by [jjtjtyt6644](https://github.com/jjtjtyt6644). Reze is a character from *Chainsaw Man* by Tatsuki Fujimoto. The default artwork is fan art found on Pinterest, and all rights belong to its original artists. Fonts: Chakra Petch, Inter, JetBrains Mono.
