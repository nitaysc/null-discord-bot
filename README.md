# ∅ null - Discord Bot (High-Fidelity Audio Engine)

A feature-rich Discord bot designed to stay online 24/7 with custom status, interactive music playback (inspired by **Lara** and **Luna Bot**), and complete command support. Powered by [Discord.js v14](https://discord.js.org/) and [Riffy](https://riffy.js.org/) with a multi-node **Lavalink v4 cluster**, specifically engineered to thrive within [bot-hosting.net](https://bot-hosting.net)'s 256MB free container limit.

---

## 🚀 Key Advantages

- 🎧 **Original Studio Audio**: Streams genuine, official studio audio from YouTube, Spotify, and SoundCloud (never random bootlegs, covers, or unauthorized remixes).
- 🛡️ **Immune to 429 Datacenter Rate Limits**: Audio streaming and network handshakes are handled directly by high-speed Lavalink nodes, bypassing shared hosting IP restrictions completely.
- 💾 **Ultra-Low RAM Footprint (~35MB)**: Offloads heavy audio transcoding away from Node.js, freeing up over 200MB of RAM for future AI chat models and bot extensions.
- 🎛️ **Interactive Controls on Now Playing**: Every time a song starts, an embed with interactive buttons is provided:
  - ⏯️ **Pause / Resume**
  - ⏭️ **Skip**
  - ⏹️ **Stop & Leave**
  - 🔀 **Shuffle**
  - 📜 **Queue Viewer**
- 📊 **Visual Progress Bar**: Real-time position tracking with interactive audio progress indicators.
- 🧹 **Smart Auto-Disconnect**: Automatically leaves the channel after everyone leaves or when the queue completes to save server memory and bandwidth.

---

## 📜 Complete Command List

### 🎶 Music Commands
| Slash Command | Description |
| :--- | :--- |
| `/play <query>` | Play a song or playlist (Official YouTube, Spotify, SoundCloud, or direct URLs) |
| `/pause` | Pause music playback |
| `/resume` | Resume paused playback |
| `/skip` | Skip the currently playing song |
| `/stop` | Stop playback, clear queue, and disconnect |
| `/queue` | View all songs currently waiting in the queue |
| `/nowplaying` | Show current song with live progress bar and control buttons |
| `/shuffle` | Randomize the order of songs in the queue |
| `/volume <1-100>` | Adjust music volume level |

### 🛠️ General & Utility Commands
| Slash Command | Description |
| :--- | :--- |
| `/ping` | Measure bot latency and Discord Gateway latency |
| `/null` | Display system status, RAM memory usage, uptime, and active audio nodes |
| `/help` | Show full command guide |

---

## 🛠️ Step 1: Discord Developer Portal Setup

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications).
2. Open your bot application named **`null`**.
3. **Enable Privileged Gateway Intents**:
   - In the **Bot** tab, scroll down to **Privileged Gateway Intents** and enable:
     - ✅ **Presence Intent**
     - ✅ **Server Members Intent**
     - ✅ **Message Content Intent**
   - Click **Save Changes**.
4. **Invite null to Your Server**:
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
   - Copy the generated URL and invite the bot to your server.

---

## 🌐 Step 2: Deploying to bot-hosting.net

1. Log into your control panel at [panel.bot-hosting.net](https://panel.bot-hosting.net).
2. Go to **File Manager**:
   - Update `index.js`, `package.json`, and `.npmrc` (from GitHub or upload directly).
   - Ensure your `.env` contains:
     ```env
     DISCORD_TOKEN=your_bot_token_here
     BOT_STATUS=null • /play
     ```
3. In the **Console** tab, click **Restart** (or **Start**).
4. Watch the console:
   ```text
   ✅ [ONLINE] Logged in as: Null#2661
   🎧 [LAVALINK] Node "Serenetia-Node" connected and ready!
   ✅ Global slash commands successfully updated!
   ```
5. Join a voice channel in Discord and run `/play alan walker faded` or any song you like! Enjoy crystal clear original studio sound!
