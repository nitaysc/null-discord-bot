# ∅ null - Discord Bot (with High-Quality Music Engine)

A feature-rich Discord bot designed to stay online 24/7 with custom status, interactive music playback (inspired by **Lara** and **Luna Bot**), and complete command support. Built on [Discord.js v14](https://discord.js.org/) and [Discord-Player v7](https://discord-player.js.org/), configured and optimized for [bot-hosting.net](https://bot-hosting.net).

---

## 🎵 Music Features (Lara & Luna Bot Style)

- 🎧 **Universal Multi-Platform Support**: Stream tracks and playlists from **YouTube**, **Spotify**, **SoundCloud**, **Apple Music**, and direct links.
- 🎛️ **Interactive Controls on Now Playing**: Every time a song starts, an embed with interactive buttons is provided:
  - ⏯️ **Pause / Resume**
  - ⏭️ **Skip**
  - ⏹️ **Stop & Leave**
  - 🔀 **Shuffle**
  - 📜 **Queue Viewer**
- 📊 **Visual Progress Bar**: Shows current playback position and song duration with dynamic audio progress indicators.
- ⚡ **Full Slash & Prefix Commands**: Use `/play` or `!play` interchangeably.
- 🧹 **Smart Auto-Disconnect**: Automatically leaves the channel after everyone disconnects or when the queue completes to save server memory and bandwidth.

---

## 📜 Complete Command List

### 🎶 Music Commands
| Slash Command | Prefix Alternative | Description |
| :--- | :--- | :--- |
| `/play <query>` | `!play <query>` | Play a song or playlist (name or URL from YouTube, Spotify, SoundCloud, etc.) |
| `/pause` | `!pause` | Pause music playback |
| `/resume` | `!resume` | Resume paused playback |
| `/skip` | `!skip` | Skip the current track |
| `/stop` | `!stop` | Stop playback, clear queue, and leave voice channel |
| `/queue` | `!queue` | View all songs currently waiting in the queue |
| `/nowplaying` | `!np` or `!nowplaying`| Show current song, artist, requester, and interactive progress bar |
| `/shuffle` | `!shuffle` | Randomize the order of songs in the queue |
| `/volume <1-100>` | `!volume <1-100>` | Adjust music volume level |

### 🛠️ General & Utility Commands
| Slash Command | Prefix Alternative | Description |
| :--- | :--- | :--- |
| `/ping` | `!ping` | Measure bot latency and Discord Gateway latency |
| `/null` | `!null` | Display status card with avatar, uptime, and servers |
| `/help` | `!help` | Show full command guide |

---

## 🛠️ Step 1: Discord Developer Portal Setup

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications).
2. Click **New Application** and name it **`null`**.
3. **Upload Profile Picture**:
   - In **General Information**, upload your chosen picture as the **App Icon**.
   - In the **Bot** tab, upload the same picture in the **Icon / Avatar** section and confirm the username is **`null`**.
4. **Get Bot Token**:
   - In the **Bot** tab, click **Reset Token** and copy it.
5. **Enable Privileged Gateway Intents**:
   - Scroll down to **Privileged Gateway Intents** and enable:
     - ✅ **Presence Intent** (For online status)
     - ✅ **Server Members Intent**
     - ✅ **Message Content Intent** (For prefix commands)
   - Click **Save Changes**.
6. **Invite null to Your Server**:
   - Go to **OAuth2 ➔ URL Generator**.
   - Under **Scopes**, check:
     - `bot`
     - `applications.commands`
   - Under **Bot Permissions**, select:
     - `Connect` (Voice)
     - `Speak` (Voice)
     - `Send Messages`
     - `Embed Links`
     - `Read Message History`
     - `View Channels`
     *(Or select `Administrator` for testing).*
   - Copy the link at the bottom and open it in your browser to invite **null** to your server.

---

## 🌐 Step 2: Hosting on bot-hosting.net

1. Log into [bot-hosting.net](https://bot-hosting.net) using your Discord account.
2. Click **Create Server** and select **NodeJS** as the software type.
3. Open your server in the **Control Panel** (panel.bot-hosting.net).
4. In the **File Manager**:
   - Upload `index.js` and `package.json`.
   - Click **New File**, name it `.env`, and paste:
     ```env
     DISCORD_TOKEN=your_copied_bot_token_here
     BOT_STATUS=null • /play
     ```
   - Click **Save**.
   *(Note: Do NOT upload `node_modules`. The panel will automatically run `npm install` on launch).*
5. In the **Startup** tab, confirm **Startup File** is `index.js`.
6. In the **Console** tab, click **Start**.
   - Watch the console install dependencies and log:
     ```text
     ✅ [ONLINE] Logged in as: null#0000
     📦 Loading audio extractors (SoundCloud, Spotify, YouTube, etc.)...
     ✅ 7 Audio extractors loaded successfully!
     🔄 Registering global slash commands...
     ✅ Global slash commands successfully updated!
     ```
   - Join any voice channel on your Discord server and type `/play faded` or `!play faded`!

---

## 🐙 Step 3: Push to Your GitHub

To save and update this code on your GitHub:

### Option A: Using GitHub CLI
```powershell
cd "C:\Users\homol\.gemini\antigravity\scratch\null-discord-bot"
git add .
git commit -m "Add high-quality music bot engine with interactive buttons and multi-platform support"
gh repo create null-discord-bot --public --source=. --push
```

### Option B: Using Git & GitHub Web
1. Create a repository named `null-discord-bot` on [github.com/new](https://github.com/new).
2. Run:
```powershell
cd "C:\Users\homol\.gemini\antigravity\scratch\null-discord-bot"
git add .
git commit -m "Add high-quality music bot engine with interactive buttons and multi-platform support"
git remote add origin https://github.com/<YOUR-USERNAME>/null-discord-bot.git
git push -u origin main
```
