require('dotenv').config();
const {
    Client,
    GatewayIntentBits,
    ActivityType,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    SlashCommandBuilder
} = require('discord.js');
const { Player, useQueue, useMainPlayer } = require('discord-player');
const { DefaultExtractors } = require('@discord-player/extractor');
const { YoutubeExtractor } = require('discord-player-youtubei');

// Ensure FFmpeg binary exists (handles npm 12 allowScripts restrictions on hosting platforms)
try {
    const ffmpegPath = require('ffmpeg-static');
    const fs = require('fs');
    if (!ffmpegPath || !fs.existsSync(ffmpegPath)) {
        console.log('📦 FFmpeg binary is missing. Downloading FFmpeg now...');
        const cp = require('child_process');
        const installer = require.resolve('ffmpeg-static/install.js');
        cp.execSync(`node "${installer}"`, { stdio: 'inherit' });
        console.log('✅ FFmpeg binary downloaded successfully!');
    }
} catch (err) {
    console.warn('⚠️ FFmpeg verification note:', err.message);
}

// Validate Discord Token
const TOKEN = process.env.DISCORD_TOKEN?.trim();
if (!TOKEN || TOKEN === 'your_bot_token_here') {
    console.error('======================================================');
    console.error('❌ ERROR: DISCORD_TOKEN is not configured!');
    console.error('Please add your valid token in the .env file or in your');
    console.error('bot-hosting.net environment variables.');
    console.error('Example: DISCORD_TOKEN=your_token_here');
    console.error('======================================================');
    process.exit(1);
}

// Initialize Client with Voice & Message intents
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// Initialize Player
const player = new Player(client, {
    skipFFmpeg: false
});

// Helper: Create sleek visual progress bar
function createProgressBar(currentMs, totalMs, length = 14) {
    if (!totalMs || totalMs === 0) return '🔘' + '▬'.repeat(length);
    const progress = Math.min(Math.max(currentMs / totalMs, 0), 1);
    const progressChars = Math.round(length * progress);
    const emptyChars = Math.max(0, length - progressChars);
    return '▬'.repeat(progressChars) + '🔘' + '▬'.repeat(emptyChars);
}

// Helper: Create interactive button controls like Luna / Lara bot
function createMusicControlButtons(isPaused = false) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('music_pause_resume')
            .setLabel(isPaused ? 'Resume' : 'Pause')
            .setEmoji(isPaused ? '▶️' : '⏸️')
            .setStyle(isPaused ? ButtonStyle.Success : ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('music_skip')
            .setLabel('Skip')
            .setEmoji('⏭️')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('music_stop')
            .setLabel('Stop')
            .setEmoji('⏹️')
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId('music_shuffle')
            .setLabel('Shuffle')
            .setEmoji('🔀')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('music_queue')
            .setLabel('Queue')
            .setEmoji('📜')
            .setStyle(ButtonStyle.Secondary)
    );
}

// Register Discord Player Events
player.events.on('playerStart', (queue, track) => {
    const embed = new EmbedBuilder()
        .setTitle('🎶 Now Playing')
        .setDescription(`**[${track.title}](${track.url})**\nBy: **${track.author}**`)
        .setThumbnail(track.thumbnail || null)
        .setColor(0x5865F2)
        .addFields(
            { name: 'Duration', value: track.duration || 'Live', inline: true },
            { name: 'Requested By', value: `${track.requestedBy?.username || 'Unknown'}`, inline: true },
            { name: 'Queue', value: `${queue.tracks.size} track(s) next`, inline: true }
        )
        .setFooter({ text: 'null Music • Use the buttons below to control playback' });

    if (queue.metadata && typeof queue.metadata.send === 'function') {
        queue.metadata.send({
            embeds: [embed],
            components: [createMusicControlButtons(false)]
        }).catch((err) => console.warn('Could not send playerStart message:', err.message));
    }
});

player.events.on('audioTrackAdd', (queue, track) => {
    // Only send notification if track is added while something is already playing
    if (queue.isPlaying()) {
        const embed = new EmbedBuilder()
            .setTitle('➕ Added to Queue')
            .setDescription(`**[${track.title}](${track.url})**`)
            .setThumbnail(track.thumbnail || null)
            .setColor(0x2B2D31)
            .addFields(
                { name: 'Duration', value: track.duration || 'Live', inline: true },
                { name: 'Position', value: `#${queue.tracks.size}`, inline: true }
            );

        if (queue.metadata && typeof queue.metadata.send === 'function') {
            queue.metadata.send({ embeds: [embed] }).catch(() => {});
        }
    }
});

player.events.on('audioTracksAdd', (queue, tracks) => {
    const embed = new EmbedBuilder()
        .setTitle('📑 Playlist Added')
        .setDescription(`Added **${tracks.length}** songs to the queue!`)
        .setColor(0x2B2D31);

    if (queue.metadata && typeof queue.metadata.send === 'function') {
        queue.metadata.send({ embeds: [embed] }).catch(() => {});
    }
});

player.events.on('emptyQueue', (queue) => {
    const embed = new EmbedBuilder()
        .setTitle('✅ Queue Finished')
        .setDescription('All songs have finished playing. Leaving voice channel.')
        .setColor(0x2B2D31);

    if (queue.metadata && typeof queue.metadata.send === 'function') {
        queue.metadata.send({ embeds: [embed] }).catch(() => {});
    }
});

player.events.on('emptyChannel', (queue) => {
    const embed = new EmbedBuilder()
        .setTitle('👋 Voice Channel Empty')
        .setDescription('Everyone left the voice channel. Stopping playback to save resources.')
        .setColor(0x2B2D31);

    if (queue.metadata && typeof queue.metadata.send === 'function') {
        queue.metadata.send({ embeds: [embed] }).catch(() => {});
    }
});

player.events.on('error', (queue, error) => {
    console.error(`[Player Error] Guild ${queue.guild?.id}:`, error.message);
});

player.events.on('playerError', (queue, error) => {
    console.error(`[Playback Error] Guild ${queue.guild?.id}:`, error.message);
    if (queue.metadata && typeof queue.metadata.send === 'function') {
        queue.metadata.send({ content: `⚠️ Error playing track: ${error.message}` }).catch(() => {});
    }
});

// Slash Command Definitions
const slashCommands = [
    new SlashCommandBuilder()
        .setName('play')
        .setDescription('Play a song or playlist (YouTube, Spotify, SoundCloud, etc.)')
        .addStringOption(option =>
            option.setName('query')
                .setDescription('The song title or link to play')
                .setRequired(true)
        ),
    new SlashCommandBuilder()
        .setName('pause')
        .setDescription('Pause current music playback'),
    new SlashCommandBuilder()
        .setName('resume')
        .setDescription('Resume paused music playback'),
    new SlashCommandBuilder()
        .setName('skip')
        .setDescription('Skip the currently playing song'),
    new SlashCommandBuilder()
        .setName('stop')
        .setDescription('Stop music playback, clear queue, and leave voice channel'),
    new SlashCommandBuilder()
        .setName('queue')
        .setDescription('Show all songs currently in queue'),
    new SlashCommandBuilder()
        .setName('nowplaying')
        .setDescription('Display the currently playing song with progress bar'),
    new SlashCommandBuilder()
        .setName('shuffle')
        .setDescription('Shuffle the upcoming songs in the queue'),
    new SlashCommandBuilder()
        .setName('volume')
        .setDescription('Adjust playback volume (1-100)')
        .addIntegerOption(option =>
            option.setName('percent')
                .setDescription('Volume level from 1 to 100')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(100)
        ),
    new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Check bot and API latency'),
    new SlashCommandBuilder()
        .setName('null')
        .setDescription('Learn about the null entity'),
    new SlashCommandBuilder()
        .setName('help')
        .setDescription('Show all commands and usage instructions')
];

// Bot Ready Event
client.once('ready', async () => {
    console.log('======================================================');
    console.log(`✅ [ONLINE] Logged in as: ${client.user.tag}`);
    console.log(`🆔 Bot ID: ${client.user.id}`);
    console.log(`🌐 Connected to ${client.guilds.cache.size} server(s)`);
    console.log('======================================================');

    // Set online presence
    const activityName = process.env.BOT_STATUS || 'null • /play';
    try {
        client.user.setPresence({
            activities: [
                {
                    name: activityName,
                    type: ActivityType.Custom,
                    state: activityName
                }
            ],
            status: 'online'
        });
        console.log(`✨ Status set to ONLINE (${activityName})`);
    } catch {
        client.user.setPresence({
            activities: [{ name: activityName, type: ActivityType.Listening }],
            status: 'online'
        });
    }

    // Load Extractors
    try {
        console.log('📦 Loading audio extractors (SoundCloud, Spotify, YouTube, etc.)...');
        await player.extractors.loadMulti(DefaultExtractors);
        await player.extractors.register(YoutubeExtractor, {});
        console.log(`✅ ${player.extractors.size} Audio extractors loaded successfully!`);
    } catch (err) {
        console.error('⚠️ Extractor loading notice:', err.message);
    }

    // Register slash commands globally
    try {
        console.log('🔄 Registering global slash commands...');
        await client.application.commands.set(slashCommands);
        console.log('✅ Global slash commands successfully updated!');
    } catch (error) {
        console.error('⚠️ Failed to register global slash commands:', error.message);
    }
});

// Handle Slash Command Interactions
client.on('interactionCreate', async (interaction) => {
    // 1. Button Controls (Interactive Player UI like Luna / Lara)
    if (interaction.isButton()) {
        const queue = useQueue(interaction.guildId);
        const memberVoice = interaction.member?.voice?.channel;

        if (!memberVoice) {
            return interaction.reply({ content: '❌ You must be in a voice channel to use the controls!', ephemeral: true });
        }

        if (queue && queue.channel?.id !== memberVoice.id) {
            return interaction.reply({ content: '❌ You must be in the same voice channel as the bot!', ephemeral: true });
        }

        if (!queue || !queue.isPlaying()) {
            return interaction.reply({ content: '❌ No music is currently playing!', ephemeral: true });
        }

        switch (interaction.customId) {
            case 'music_pause_resume': {
                const isPaused = queue.node.isPaused();
                if (isPaused) {
                    queue.node.resume();
                    await interaction.reply({ content: '▶️ Resumed music playback!', ephemeral: true });
                } else {
                    queue.node.pause();
                    await interaction.reply({ content: '⏸️ Paused music playback!', ephemeral: true });
                }
                break;
            }
            case 'music_skip': {
                const current = queue.currentTrack;
                queue.node.skip();
                await interaction.reply({ content: `⏭️ Skipped **${current?.title || 'current song'}**!`, ephemeral: true });
                break;
            }
            case 'music_stop': {
                queue.delete();
                await interaction.reply({ content: '⏹️ Stopped music, cleared the queue, and disconnected.', ephemeral: true });
                break;
            }
            case 'music_shuffle': {
                if (queue.tracks.size < 2) {
                    return interaction.reply({ content: '⚠️ Need at least 2 songs in queue to shuffle!', ephemeral: true });
                }
                queue.tracks.shuffle();
                await interaction.reply({ content: `🔀 Shuffled **${queue.tracks.size}** songs in the queue!`, ephemeral: true });
                break;
            }
            case 'music_queue': {
                const tracks = queue.tracks.toArray();
                const current = queue.currentTrack;
                if (!tracks.length) {
                    return interaction.reply({
                        content: `🎶 **Now Playing:** ${current?.title}\n*(No other songs in queue)*`,
                        ephemeral: true
                    });
                }
                const trackList = tracks.slice(0, 10).map((t, idx) => `**${idx + 1}.** ${t.title} (\`${t.duration}\`)`).join('\n');
                const embed = new EmbedBuilder()
                    .setTitle(`📜 Queue (${tracks.length} songs)`)
                    .setDescription(`**Now Playing:** ${current?.title}\n\n**Upcoming:**\n${trackList}${tracks.length > 10 ? `\n*...and ${tracks.length - 10} more*` : ''}`)
                    .setColor(0x5865F2);
                await interaction.reply({ embeds: [embed], ephemeral: true });
                break;
            }
        }
        return;
    }

    // 2. Chat Input Commands
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;

    // --- /play ---
    if (commandName === 'play') {
        const query = interaction.options.getString('query');
        const voiceChannel = interaction.member?.voice?.channel;

        if (!voiceChannel) {
            return interaction.reply({ content: '❌ You must be in a voice channel to play music!', ephemeral: true });
        }

        const permissions = voiceChannel.permissionsFor(interaction.client.user);
        if (!permissions.has('Connect') || !permissions.has('Speak')) {
            return interaction.reply({ content: '❌ I do not have permission to Connect or Speak in your voice channel!', ephemeral: true });
        }

        await interaction.deferReply();

        try {
            const { track, searchResult } = await player.play(voiceChannel, query, {
                nodeOptions: {
                    metadata: interaction.channel,
                    volume: 80,
                    leaveOnEmpty: true,
                    leaveOnEmptyCooldown: 120000,
                    leaveOnEnd: true,
                    leaveOnEndCooldown: 120000
                },
                requestedBy: interaction.user
            });

            if (searchResult.hasPlaylist()) {
                const embed = new EmbedBuilder()
                    .setTitle('📑 Playlist Enqueued')
                    .setDescription(`Added playlist **[${searchResult.playlist.title}](${searchResult.playlist.url})** with **${searchResult.tracks.length}** songs!`)
                    .setColor(0x5865F2);
                return interaction.editReply({ embeds: [embed] });
            }

            const embed = new EmbedBuilder()
                .setTitle('🎶 Enqueued')
                .setDescription(`**[${track.title}](${track.url})**\nBy: **${track.author}**`)
                .setThumbnail(track.thumbnail || null)
                .setColor(0x5865F2)
                .addFields(
                    { name: 'Duration', value: track.duration || 'Live', inline: true },
                    { name: 'Channel', value: `${voiceChannel.name}`, inline: true }
                );

            return interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error('Play error:', error);
            return interaction.editReply({ content: `❌ Error loading track: ${error.message}` });
        }
    }

    // --- /pause ---
    if (commandName === 'pause') {
        const queue = useQueue(interaction.guildId);
        if (!queue || !queue.isPlaying()) {
            return interaction.reply({ content: '❌ No music is currently playing!', ephemeral: true });
        }
        if (queue.node.isPaused()) {
            return interaction.reply({ content: '⚠️ The music is already paused!', ephemeral: true });
        }
        queue.node.pause();
        return interaction.reply({ content: '⏸️ Paused the music!' });
    }

    // --- /resume ---
    if (commandName === 'resume') {
        const queue = useQueue(interaction.guildId);
        if (!queue || !queue.isPlaying()) {
            return interaction.reply({ content: '❌ No music is currently playing!', ephemeral: true });
        }
        if (!queue.node.isPaused()) {
            return interaction.reply({ content: '⚠️ Music is not paused!', ephemeral: true });
        }
        queue.node.resume();
        return interaction.reply({ content: '▶️ Resumed music playback!' });
    }

    // --- /skip ---
    if (commandName === 'skip') {
        const queue = useQueue(interaction.guildId);
        if (!queue || !queue.isPlaying()) {
            return interaction.reply({ content: '❌ No music is currently playing!', ephemeral: true });
        }
        const current = queue.currentTrack;
        queue.node.skip();
        return interaction.reply({ content: `⏭️ Skipped **${current?.title || 'track'}**!` });
    }

    // --- /stop ---
    if (commandName === 'stop') {
        const queue = useQueue(interaction.guildId);
        if (!queue) {
            return interaction.reply({ content: '❌ The bot is not in a voice channel!', ephemeral: true });
        }
        queue.delete();
        return interaction.reply({ content: '⏹️ Stopped music, cleared queue, and left the voice channel.' });
    }

    // --- /queue ---
    if (commandName === 'queue') {
        const queue = useQueue(interaction.guildId);
        if (!queue || !queue.isPlaying()) {
            return interaction.reply({ content: '❌ No music is currently playing!', ephemeral: true });
        }

        const tracks = queue.tracks.toArray();
        const current = queue.currentTrack;
        const trackList = tracks.length > 0
            ? tracks.slice(0, 10).map((t, idx) => `**${idx + 1}.** ${t.title} (\`${t.duration}\`)`).join('\n')
            : '*(No additional songs in queue)*';

        const embed = new EmbedBuilder()
            .setTitle(`📜 Queue for ${interaction.guild.name}`)
            .setDescription(`**Now Playing:**\n**[${current?.title}](${current?.url})** (\`${current?.duration}\`)\n\n**Upcoming Tracks:**\n${trackList}${tracks.length > 10 ? `\n*...and ${tracks.length - 10} more*` : ''}`)
            .setColor(0x5865F2)
            .setFooter({ text: `${tracks.length} song(s) in queue` });

        return interaction.reply({ embeds: [embed] });
    }

    // --- /nowplaying ---
    if (commandName === 'nowplaying') {
        const queue = useQueue(interaction.guildId);
        if (!queue || !queue.isPlaying()) {
            return interaction.reply({ content: '❌ No music is currently playing!', ephemeral: true });
        }

        const track = queue.currentTrack;
        const progressTime = queue.node.playbackTime;
        const totalTime = queue.node.totalDuration;
        const bar = createProgressBar(progressTime, totalTime);

        const embed = new EmbedBuilder()
            .setTitle('🎶 Now Playing')
            .setDescription(`**[${track.title}](${track.url})**\nBy: **${track.author}**\n\n${bar}\n\`${queue.node.getTimestamp()?.current?.label || '0:00'} / ${track.duration}\``)
            .setThumbnail(track.thumbnail || null)
            .setColor(0x5865F2)
            .addFields(
                { name: 'Volume', value: `${queue.node.volume}%`, inline: true },
                { name: 'Requested By', value: `${track.requestedBy?.username || 'Unknown'}`, inline: true }
            );

        return interaction.reply({
            embeds: [embed],
            components: [createMusicControlButtons(queue.node.isPaused())]
        });
    }

    // --- /shuffle ---
    if (commandName === 'shuffle') {
        const queue = useQueue(interaction.guildId);
        if (!queue || queue.tracks.size < 2) {
            return interaction.reply({ content: '⚠️ Need at least 2 songs in queue to shuffle!', ephemeral: true });
        }
        queue.tracks.shuffle();
        return interaction.reply({ content: `🔀 Shuffled **${queue.tracks.size}** songs in the queue!` });
    }

    // --- /volume ---
    if (commandName === 'volume') {
        const percent = interaction.options.getInteger('percent');
        const queue = useQueue(interaction.guildId);
        if (!queue || !queue.isPlaying()) {
            return interaction.reply({ content: '❌ No music is currently playing!', ephemeral: true });
        }
        queue.node.setVolume(percent);
        return interaction.reply({ content: `🔊 Volume set to **${percent}%**!` });
    }

    // --- /ping ---
    if (commandName === 'ping') {
        const sent = await interaction.reply({ content: 'Pinging...', fetchReply: true });
        const roundtripLatency = sent.createdTimestamp - interaction.createdTimestamp;
        const apiLatency = Math.round(client.ws.ping);

        const embed = new EmbedBuilder()
            .setTitle('🏓 Pong!')
            .setColor(0x2B2D31)
            .addFields(
                { name: 'Bot Latency', value: `${roundtripLatency}ms`, inline: true },
                { name: 'API Latency', value: `${apiLatency}ms`, inline: true }
            )
            .setFooter({ text: 'null • Online and responsive' });

        return interaction.editReply({ content: null, embeds: [embed] });
    }

    // --- /null ---
    if (commandName === 'null') {
        const uptimeHours = Math.floor(client.uptime / 3600000);
        const uptimeMinutes = Math.floor((client.uptime % 3600000) / 60000);
        const uptimeSeconds = Math.floor((client.uptime % 60000) / 1000);

        const embed = new EmbedBuilder()
            .setTitle('∅ null')
            .setDescription('An entity hovering in the void. Online, responsive, and musical.')
            .setColor(0x000000)
            .setThumbnail(client.user.displayAvatarURL({ dynamic: true, size: 256 }))
            .addFields(
                { name: 'Status', value: '🟢 Online', inline: true },
                { name: 'Uptime', value: `${uptimeHours}h ${uptimeMinutes}m ${uptimeSeconds}s`, inline: true },
                { name: 'Servers', value: `${client.guilds.cache.size}`, inline: true }
            )
            .setFooter({ text: 'null • Ready for audio & commands' });

        return interaction.reply({ embeds: [embed] });
    }

    // --- /help ---
    if (commandName === 'help') {
        const embed = new EmbedBuilder()
            .setTitle('📖 null Command Center')
            .setColor(0x5865F2)
            .setDescription('**High quality music playback inspired by Lara & Luna bot**\nSupports YouTube, Spotify, SoundCloud, Apple Music, and direct links.')
            .addFields(
                { name: '🎵 Music Commands', value: '`/play <song/url>` - Play song or playlist\n`/pause` - Pause playback\n`/resume` - Resume playback\n`/skip` - Skip current track\n`/stop` - Stop music & leave channel\n`/queue` - View upcoming songs\n`/nowplaying` - Show current song & progress\n`/shuffle` - Shuffle queue\n`/volume <1-100>` - Change volume' },
                { name: '🎮 Utility Commands', value: '`/ping` - View latency\n`/null` - Bot status & information\n`/help` - This help menu' },
                { name: '🎛️ Interactive Controls', value: 'Every song played comes with interactive **Pause, Skip, Stop, Shuffle, and Queue buttons** attached!' }
            )
            .setFooter({ text: 'null Discord Bot' });

        return interaction.reply({ embeds: [embed] });
    }
});

// Prefix Command Support (!play, !pause, !skip, !stop, !queue, etc.)
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.content) return;

    const prefix = '!';
    if (!message.content.startsWith(prefix)) return;

    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const command = args.shift()?.toLowerCase();

    // !play <query>
    if (command === 'play') {
        const query = args.join(' ');
        const voiceChannel = message.member?.voice?.channel;

        if (!voiceChannel) {
            return message.reply('❌ You must be in a voice channel to play music!');
        }
        if (!query) {
            return message.reply('⚠️ Please provide a song name or URL! (e.g., `!play Faded Alan Walker`)');
        }

        const msg = await message.reply('🔍 Searching and loading...');

        try {
            const { track, searchResult } = await player.play(voiceChannel, query, {
                nodeOptions: {
                    metadata: message.channel,
                    volume: 80,
                    leaveOnEmpty: true,
                    leaveOnEmptyCooldown: 120000,
                    leaveOnEnd: true,
                    leaveOnEndCooldown: 120000
                },
                requestedBy: message.author
            });

            if (searchResult.hasPlaylist()) {
                const embed = new EmbedBuilder()
                    .setTitle('📑 Playlist Enqueued')
                    .setDescription(`Added playlist **[${searchResult.playlist.title}](${searchResult.playlist.url})** with **${searchResult.tracks.length}** songs!`)
                    .setColor(0x5865F2);
                return msg.edit({ content: null, embeds: [embed] });
            }

            const embed = new EmbedBuilder()
                .setTitle('🎶 Enqueued')
                .setDescription(`**[${track.title}](${track.url})**\nBy: **${track.author}**`)
                .setThumbnail(track.thumbnail || null)
                .setColor(0x5865F2)
                .addFields(
                    { name: 'Duration', value: track.duration || 'Live', inline: true },
                    { name: 'Channel', value: `${voiceChannel.name}`, inline: true }
                );

            return msg.edit({ content: null, embeds: [embed] });
        } catch (error) {
            console.error('Prefix play error:', error);
            return msg.edit(`❌ Error loading track: ${error.message}`);
        }
    }

    // !skip
    if (command === 'skip') {
        const queue = useQueue(message.guildId);
        if (!queue || !queue.isPlaying()) return message.reply('❌ No music playing!');
        const current = queue.currentTrack;
        queue.node.skip();
        return message.reply(`⏭️ Skipped **${current?.title || 'track'}**!`);
    }

    // !pause
    if (command === 'pause') {
        const queue = useQueue(message.guildId);
        if (!queue || !queue.isPlaying()) return message.reply('❌ No music playing!');
        queue.node.pause();
        return message.reply('⏸️ Paused playback!');
    }

    // !resume
    if (command === 'resume') {
        const queue = useQueue(message.guildId);
        if (!queue || !queue.isPlaying()) return message.reply('❌ No music playing!');
        queue.node.resume();
        return message.reply('▶️ Resumed playback!');
    }

    // !stop
    if (command === 'stop') {
        const queue = useQueue(message.guildId);
        if (!queue) return message.reply('❌ Not currently in a voice channel!');
        queue.delete();
        return message.reply('⏹️ Stopped music and cleared the queue.');
    }

    // !queue
    if (command === 'queue') {
        const queue = useQueue(message.guildId);
        if (!queue || !queue.isPlaying()) return message.reply('❌ No music playing!');
        const tracks = queue.tracks.toArray();
        const current = queue.currentTrack;
        const trackList = tracks.length > 0
            ? tracks.slice(0, 10).map((t, idx) => `**${idx + 1}.** ${t.title} (\`${t.duration}\`)`).join('\n')
            : '*(No additional songs)*';

        const embed = new EmbedBuilder()
            .setTitle(`📜 Queue (${tracks.length} songs)`)
            .setDescription(`**Now Playing:** ${current?.title}\n\n**Upcoming:**\n${trackList}`)
            .setColor(0x5865F2);
        return message.reply({ embeds: [embed] });
    }

    // !np or !nowplaying
    if (command === 'np' || command === 'nowplaying') {
        const queue = useQueue(message.guildId);
        if (!queue || !queue.isPlaying()) return message.reply('❌ No music playing!');
        const track = queue.currentTrack;
        const progressTime = queue.node.playbackTime;
        const totalTime = queue.node.totalDuration;
        const bar = createProgressBar(progressTime, totalTime);

        const embed = new EmbedBuilder()
            .setTitle('🎶 Now Playing')
            .setDescription(`**[${track.title}](${track.url})**\nBy: **${track.author}**\n\n${bar}`)
            .setColor(0x5865F2);
        return message.reply({ embeds: [embed] });
    }

    // !volume <number>
    if (command === 'volume') {
        const queue = useQueue(message.guildId);
        if (!queue || !queue.isPlaying()) return message.reply('❌ No music playing!');
        const vol = parseInt(args[0]);
        if (isNaN(vol) || vol < 1 || vol > 100) return message.reply('⚠️ Volume must be between 1 and 100!');
        queue.node.setVolume(vol);
        return message.reply(`🔊 Volume set to **${vol}%**!`);
    }

    // !ping
    if (command === 'ping') {
        const msg = await message.reply('Pinging...');
        const roundtrip = msg.createdTimestamp - message.createdTimestamp;
        return msg.edit(`🏓 Pong! Bot latency: **${roundtrip}ms** | API latency: **${Math.round(client.ws.ping)}ms**`);
    }

    // !help
    if (command === 'help') {
        return message.reply('📖 Use `/help` to see the full list of music and utility commands, or use `/play <query>` to begin!');
    }
});

// Process Error Handling
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

// Log In
client.login(TOKEN);
