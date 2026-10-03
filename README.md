# ∅ null - Discord Bot

A sleek, lightweight Discord bot designed to stay online 24/7 with a custom presence, built with [Discord.js v14](https://discord.js.org/) and ready for deployment on [bot-hosting.net](https://bot-hosting.net).

---

## 📋 Features

- 🟢 **Always Online Presence**: Automatically sets status to **Online** with customizable activity text (default: `null`).
- ⚡ **Slash Commands & Prefix Support**:
  - `/ping` & `!ping` - Shows real-time bot latency and Discord API latency.
  - `/null` & `!null` - Displays status card with the bot avatar, uptime, and server count.
  - `/help` & `!help` - Lists all commands and instructions.
- 🚀 **Pre-configured for bot-hosting.net**: Works seamlessly on Pterodactyl-based Node.js hosting.
- 🔒 **Secure Environment Variables**: Keeps your Discord token protected via `.env`.

---

## 🛠️ Step 1: Create the Bot on Discord Developer Portal

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications).
2. Click **New Application** (top right) and name it **`null`**.
3. **Add your Profile Picture**:
   - On the **General Information** page, upload your chosen picture as the **App Icon**.
4. **Configure the Bot**:
   - In the left sidebar, click **Bot**.
   - Under **Username**, ensure it is named `null`.
   - Upload your picture in the **Icon / Avatar** section here as well.
   - Click **Reset Token** and copy your **Bot Token**. *(Keep this secret!)*
5. **Enable Intents** (Important):
   - Scroll down to **Privileged Gateway Intents**.
   - Enable:
     - ✅ **Presence Intent**
     - ✅ **Server Members Intent**
     - ✅ **Message Content Intent**
   - Click **Save Changes**.
6. **Invite the Bot to your Discord Server**:
   - Go to **OAuth2** ➔ **URL Generator** in the left sidebar.
   - Under **Scopes**, check:
     - `bot`
     - `applications.commands`
   - Under **Bot Permissions**, check:
     - `Send Messages`
     - `Embed Links`
     - `Read Message History`
     - `View Channels`
     *(Or select `Administrator` for full access).*
   - Copy the generated URL at the bottom, paste it into your browser, select your server, and click **Authorize**.

---

## 🌐 Step 2: Host on bot-hosting.net

[bot-hosting.net](https://bot-hosting.net) provides free 24/7 bot hosting.

1. Go to [bot-hosting.net](https://bot-hosting.net) and log in with your Discord account.
2. Click **Create Server**.
3. Select **NodeJS** as the server type / software.
4. Open your server in the **Control Panel** (panel.bot-hosting.net).
5. Go to the **File Manager** tab:
   - Upload `index.js` and `package.json`.
   - Click **New File**, name it `.env`, and paste:
     ```env
     DISCORD_TOKEN=your_copied_bot_token_here
     BOT_STATUS=null
     ```
   - Click **Create File / Save**.
   *(Note: You do not need to upload `node_modules`. The server installs them automatically).*
6. Go to the **Startup** tab:
   - Ensure the **Startup File** is set to `index.js`.
7. Go to the **Console** tab and click **Start**:
   - The server will run `npm install` and launch `index.js`.
   - You will see:
     ```
     ✅ [ONLINE] Logged in as: null#0000
     ✨ Presence status set to: ONLINE (null)
     ```
   - Check Discord — your bot `null` is now **Online** with its custom picture!

---

## 💻 Step 3: Local Testing (Optional)

If you want to run or test the bot on your computer before uploading:

1. Clone or open this folder in terminal.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create `.env` from `.env.example` and insert your token:
   ```env
   DISCORD_TOKEN=your_discord_bot_token_here
   BOT_STATUS=null
   ```
4. Start the bot:
   ```bash
   npm start
   ```

---

## 🐙 Step 4: Push to Your GitHub

To link and push this bot to your GitHub account:

### Method A: Using GitHub CLI (`gh`)
Run this in PowerShell / Terminal:
```bash
# 1. Login to GitHub
gh auth login

# 2. Create the repository on your GitHub and push
gh repo create null-discord-bot --public --source=. --push
```

### Method B: Using Git & GitHub Web
1. Go to [github.com/new](https://github.com/new) and create a new repository called `null-discord-bot`.
2. Run these commands inside this folder:
```bash
git remote add origin https://github.com/<YOUR-USERNAME>/null-discord-bot.git
git push -u origin main
```

---

## 📁 Project Structure

```text
null-discord-bot/
├── .env.example       # Sample environment configuration
├── .gitignore          # Prevents committing node_modules & secret .env
├── index.js            # Main bot logic, presence handling & commands
├── package.json        # Node.js project manifest & dependencies
└── README.md           # Setup, deployment & hosting guide
```
