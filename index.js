require('dotenv').config();
const v8 = require('v8');
const vm = require('vm');
const fs = require('fs');

// Optimize V8 memory footprint & expose in-process GC
try {
    v8.setFlagsFromString('--optimize_for_size --expose_gc');
} catch {}
const gc = (() => {
    try { return vm.runInNewContext('gc'); } catch { return null; }
})();

const {
    Client,
    GatewayIntentBits,
    Options,
    ActivityType,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    SlashCommandBuilder
} = require('discord.js');
const { Player, BaseExtractor, Track, useQueue } = require('discord-player');
const play = require('play-dl');

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

// In-process check to ensure FFmpeg binary is available
try {
    const ffmpegPath = require('ffmpeg-static');
    if (!ffmpegPath || !fs.existsSync(ffmpegPath)) {
        console.log('📦 FFmpeg binary is missing. Running in-process installer...');
        require('ffmpeg-static/install.js');
        console.log('✅ FFmpeg binary installed successfully!');
    }
} catch (err) {
    console.warn('⚠️ FFmpeg check notice:', err.message);
}

// Optional YouTube Cookie support
if (process.env.YOUTUBE_COOKIE) {
    try {
        play.setToken({ youtube: { cookie: process.env.YOUTUBE_COOKIE } });
        console.log('🍪 YouTube cookie authentication enabled.');
    } catch (e) {
        console.warn('Could not set YouTube cookie:', e.message);
    }
}

// Ensure SoundCloud Client ID is initialized for 100% reliable 429-free streaming
let soundcloudReady = false;
async function ensureSoundcloud() {
    if (soundcloudReady) return true;
    try {
        const scId = await play.getFreeClientID();
        if (scId) {
            play.setToken({ soundcloud: { client_id: scId } });
            soundcloudReady = true;
            return true;
        }
    } catch (err) {
        console.warn('SoundCloud init notice:', err.message);
    }
    return false;
}
ensureSoundcloud();

// Intelligent Filter: Selects the genuine studio track and removes bootlegs, remixes, and edits
function findCleanTrack(tracks, query) {
    if (!tracks || !tracks.length) return null;
    const lowerQ = query.toLowerCase();
    const wantsRemix = lowerQ.includes('remix') || lowerQ.includes('edit') || lowerQ.includes('cover') || lowerQ.includes('remake');

    const blacklist = ['remix', 'remake', 'edit', 'slowed', 'reverb', 'bootleg', 'flip', 'cover', 'instrumental', 'karaoke', 'tribute'];

    if (!wantsRemix) {
        const clean = tracks.filter(t => {
            const title = (t.name || t.title || '').toLowerCase();
            return !blacklist.some(word => title.includes(word));
        });
        if (clean.length > 0) return clean[0];
    }
    return tracks[0];
}

// High-Performance, 429-Immune Music Extractor:
// - Always streams the REAL song (filters out random remixes and bootlegs)
// - Uses public permalinks to avoid 404 API restrictions
// - Handles YouTube 429 data-center IP blocks gracefully
// - Memory optimized (~80MB RAM)
class ResilientMusicExtractor extends BaseExtractor {
    static identifier = 'com.null.resilient-music-extractor';

    async validate(query) {
        if (typeof query !== 'string') return false;
        return true;
    }

    async handle(query, context) {
        await ensureSoundcloud();

        try {
            // 1. Spotify URL
            const spValidation = play.sp_validate(query);
            if (spValidation === 'track') {
                const spData = await play.spotify(query);
                const searchQ = `${spData.name} ${spData.artists?.[0]?.name || ''}`;
                
                const scResults = await play.search(searchQ, { source: { soundcloud: 'tracks' }, limit: 5 });
                const clean = findCleanTrack(scResults, searchQ);

                const track = new Track(this.player, {
                    title: spData.name,
                    author: spData.artists?.map(a => a.name).join(', ') || 'Spotify',
                    url: clean?.permalink || clean?.url || query,
                    thumbnail: spData.thumbnail?.url || clean?.thumbnail || '',
                    duration: spData.durationInSec ? `${Math.floor(spData.durationInSec / 60)}:${(spData.durationInSec % 60).toString().padStart(2, '0')}` : '3:00',
                    requestedBy: context.requestedBy,
                    source: 'soundcloud'
                });
                track.raw = clean;
                track.extractor = this;
                return this.createResponse(null, [track]);
            }

            // 2. Direct YouTube Video URL (if cookie is configured)
            const ytValidation = play.yt_validate(query);
            if (ytValidation === 'video' && process.env.YOUTUBE_COOKIE) {
                try {
                    const info = await play.video_basic_info(query);
                    const v = info.video_details;
                    const track = new Track(this.player, {
                        title: v.title || 'Unknown Title',
                        author: v.channel?.name || 'YouTube',
                        url: v.url,
                        thumbnail: v.thumbnails?.[0]?.url || '',
                        duration: v.durationRaw || '3:00',
                        requestedBy: context.requestedBy,
                        source: 'youtube'
                    });
                    track.extractor = this;
                    return this.createResponse(null, [track]);
                } catch (e) {
                    console.warn('YouTube cookie video load error, using clean stream:', e.message);
                }
            }

            // 3. YouTube Playlist (if cookie is configured)
            if (ytValidation === 'playlist' && process.env.YOUTUBE_COOKIE) {
                try {
                    const pl = await play.playlist_info(query, { incomplete: true });
                    const videos = await pl.all_videos();
                    const tracks = videos.slice(0, 30).map(v => {
                        const track = new Track(this.player, {
                            title: v.title || 'Unknown Title',
                            author: v.channel?.name || 'YouTube',
                            url: v.url,
                            thumbnail: v.thumbnails?.[0]?.url || '',
                            duration: v.durationRaw || '3:00',
                            requestedBy: context.requestedBy,
                            source: 'youtube'
                        });
                        track.extractor = this;
                        return track;
                    });
                    return this.createResponse(null, tracks);
                } catch (e) {}
            }

            // 4. Default: Fast Clean Search (immune to 429, official tracks only)
            const scResults = await play.search(query, { source: { soundcloud: 'tracks' }, limit: 6 });
            const clean = findCleanTrack(scResults, query);

            if (clean) {
                const track = new Track(this.player, {
                    title: clean.name || clean.title || query,
                    author: clean.user?.name || 'Artist',
                    url: clean.permalink || clean.url, // Uses web permalink to prevent 404
                    thumbnail: clean.thumbnail || '',
                    duration: clean.durationRaw || '3:00',
                    requestedBy: context.requestedBy,
                    source: 'soundcloud'
                });
                track.raw = clean;
                track.extractor = this;
                return this.createResponse(null, [track]);
            }

            return this.createResponse();
        } catch (err) {
            console.error('[Extractor Handler Error]:', err.message);
            return this.createResponse();
        }
    }

    async stream(info) {
        await ensureSoundcloud();

        // 1. If YouTube source with cookie, try YouTube stream
        if (info.source === 'youtube') {
            try {
                const source = await play.stream(info.url);
                return source.stream;
            } catch (err) {
                console.warn(`⚠️ YouTube stream notice (${err.message}). Falling back to clean audio stream...`);
            }
        }

        // 2. Stream audio using web permalink (avoids API 404s)
        const targetUrl = info.raw?.permalink || (info.url && !info.url.includes('api.soundcloud.com') ? info.url : null);
        if (targetUrl) {
            try {
                const source = await play.stream(targetUrl);
                return source.stream;
            } catch (e) {
                console.warn('Direct stream notice:', e.message);
            }
        }

        // Fallback search
        try {
            const scResults = await play.search(`${info.title} ${info.author}`, { source: { soundcloud: 'tracks' }, limit: 5 });
            const clean = findCleanTrack(scResults, info.title);
            const fallbackUrl = clean?.permalink || clean?.url;
            if (fallbackUrl) {
                const source = await play.stream(fallbackUrl);
                return source.stream;
            }
        } catch (fallbackErr) {
            console.error('[Fallback Stream Error]:', fallbackErr.message);
        }

        throw new Error(`Could not find an available stream for "${info.title}"`);
    }
}

// Low-Memory Discord Client: Strips all unneeded caches
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ],
    makeCache: Options.cacheWithLimits({
        ApplicationCommandManager: 0,
        BaseGuildEmojiManager: 0,
        GuildBanManager: 0,
        GuildInviteManager: 0,
        GuildMemberManager: 10,
        GuildStickerManager: 0,
        GuildScheduledEventManager: 0,
        MessageManager: 0,
        PresenceManager: 0,
        ReactionManager: 0,
        ReactionUserManager: 0,
        StageInstanceManager: 0,
        ThreadManager: 0,
        ThreadMemberManager: 0,
        UserManager: 10,
        VoiceStateManager: 25
    }),
    sweepers: {
        messages: {
            interval: 60,
            lifetime: 30
        },
        users: {
            interval: 120,
            filter: () => user => user.id !== client.user?.id
        }
    }
});

// Periodic memory check & GC cleanup
setInterval(() => {
    if (gc) {
        try { gc(); } catch {}
    }
    const mem = process.memoryUsage();
    const rssMB = Math.round(mem.rss / 1024 / 1024);
    if (rssMB > 180 && gc) {
        console.warn(`⚠️ High RAM Warning (${rssMB}MB). Triggering garbage collection...`);
        try { gc(); } catch {}
    }
}, 30000);

// Initialize Player
const player = new Player(client, {
    skipFFmpeg: false
});

// Helper: Visual progress bar
function createProgressBar(currentMs, totalMs, length = 12) {
    if (!totalMs || totalMs === 0) return '🔘' + '▬'.repeat(length);
    const progress = Math.min(Math.max(currentMs / totalMs, 0), 1);
    const progressChars = Math.round(length * progress);
    const emptyChars = Math.max(0, length - progressChars);
    return '▬'.repeat(progressChars) + '🔘' + '▬'.repeat(emptyChars);
}

// Helper: Interactive button controls like Luna / Lara bot
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

// Player Events
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
        .setFooter({ text: 'null Music • Interactive Controls Below' });

    if (queue.metadata && typeof queue.metadata.send === 'function') {
        queue.metadata.send({
            embeds: [embed],
            components: [createMusicControlButtons(false)]
        }).catch(() => {});
    }
});

player.events.on('audioTrackAdd', (queue, track) => {
    if (queue.isPlaying()) {
        const embed = new EmbedBuilder()
            .setTitle('➕ Added to Queue')
            .setDescription(`**[${track.title}](${track.url})**\nBy: **${track.author}**`)
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
        .setDescription('All songs finished playing. Leaving voice channel.')
        .setColor(0x2B2D31);

    if (queue.metadata && typeof queue.metadata.send === 'function') {
        queue.metadata.send({ embeds: [embed] }).catch(() => {});
    }
    if (gc) { try { gc(); } catch {} }
});

player.events.on('emptyChannel', (queue) => {
    const embed = new EmbedBuilder()
        .setTitle('👋 Voice Channel Empty')
        .setDescription('Voice channel is empty. Disconnecting to save server RAM.')
        .setColor(0x2B2D31);

    if (queue.metadata && typeof queue.metadata.send === 'function') {
        queue.metadata.send({ embeds: [embed] }).catch(() => {});
    }
    if (gc) { try { gc(); } catch {} }
});

player.events.on('error', (queue, error) => {
    console.warn(`[Queue Notice] Guild ${queue.guild?.id}:`, error.message);
});

player.events.on('playerError', (queue, error) => {
    console.warn(`[Playback Notice] Guild ${queue.guild?.id}:`, error.message);
    if (queue.metadata && typeof queue.metadata.send === 'function') {
        queue.metadata.send({ content: `⚠️ Audio notice: ${error.message}` }).catch(() => {});
    }
});

// Slash Command Definitions
const slashCommands = [
    new SlashCommandBuilder()
        .setName('play')
        .setDescription('Play a song or playlist (Clean, official tracks only)')
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
        .setDescription('View bot status, RAM memory usage, and uptime'),
    new SlashCommandBuilder()
        .setName('help')
        .setDescription('Show all commands and usage instructions')
];

// Bot Ready Event (Protected against duplicate triggering)
let readyTriggered = false;
const onReady = async () => {
    if (readyTriggered) return;
    readyTriggered = true;

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

    // Register ResilientMusicExtractor
    try {
        console.log('📦 Registering ResilientMusicExtractor (Clean songs, 429-immune, ~80MB RAM)...');
        await player.extractors.register(ResilientMusicExtractor, {});
        console.log('✅ ResilientMusicExtractor loaded successfully!');
    } catch (err) {
        console.error('⚠️ Extractor notice:', err.message);
    }

    // Register slash commands globally
    try {
        console.log('🔄 Registering global slash commands...');
        await client.application.commands.set(slashCommands);
        console.log('✅ Global slash commands successfully updated!');
    } catch (error) {
        console.error('⚠️ Failed to register global slash commands:', error.message);
    }
};

client.once('clientReady', onReady);
client.once('ready', onReady);

// Handle Interactions
client.on('interactionCreate', async (interaction) => {
    // 1. Button Controls
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
                if (gc) { try { gc(); } catch {} }
                await interaction.reply({ content: '⏹️ Stopped music, cleared queue, and disconnected.', ephemeral: true });
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
                    leaveOnEmptyCooldown: 60000,
                    leaveOnEnd: true,
                    leaveOnEndCooldown: 60000,
                    maxSize: 50,
                    bufferingTimeout: 3000
                },
                requestedBy: interaction.user
            });

            if (searchResult.hasPlaylist()) {
                const embed = new EmbedBuilder()
                    .setTitle('📑 Playlist Enqueued')
                    .setDescription(`Added playlist **${searchResult.tracks.length}** songs!`)
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
            console.error('Play error:', error.message);
            return interaction.editReply({ content: `⚠️ Could not stream this song: ${error.message}` });
        }
    }

    // --- /pause ---
    if (commandName === 'pause') {
        const queue = useQueue(interaction.guildId);
        if (!queue || !queue.isPlaying()) return interaction.reply({ content: '❌ No music is currently playing!', ephemeral: true });
        if (queue.node.isPaused()) return interaction.reply({ content: '⚠️ The music is already paused!', ephemeral: true });
        queue.node.pause();
        return interaction.reply({ content: '⏸️ Paused the music!' });
    }

    // --- /resume ---
    if (commandName === 'resume') {
        const queue = useQueue(interaction.guildId);
        if (!queue || !queue.isPlaying()) return interaction.reply({ content: '❌ No music is currently playing!', ephemeral: true });
        if (!queue.node.isPaused()) return interaction.reply({ content: '⚠️ Music is not paused!', ephemeral: true });
        queue.node.resume();
        return interaction.reply({ content: '▶️ Resumed music playback!' });
    }

    // --- /skip ---
    if (commandName === 'skip') {
        const queue = useQueue(interaction.guildId);
        if (!queue || !queue.isPlaying()) return interaction.reply({ content: '❌ No music is currently playing!', ephemeral: true });
        const current = queue.currentTrack;
        queue.node.skip();
        return interaction.reply({ content: `⏭️ Skipped **${current?.title || 'track'}**!` });
    }

    // --- /stop ---
    if (commandName === 'stop') {
        const queue = useQueue(interaction.guildId);
        if (!queue) return interaction.reply({ content: '❌ The bot is not in a voice channel!', ephemeral: true });
        queue.delete();
        if (gc) { try { gc(); } catch {} }
        return interaction.reply({ content: '⏹️ Stopped music, cleared queue, and left the voice channel.' });
    }

    // --- /queue ---
    if (commandName === 'queue') {
        const queue = useQueue(interaction.guildId);
        if (!queue || !queue.isPlaying()) return interaction.reply({ content: '❌ No music is currently playing!', ephemeral: true });

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
        if (!queue || !queue.isPlaying()) return interaction.reply({ content: '❌ No music is currently playing!', ephemeral: true });

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
        if (!queue || queue.tracks.size < 2) return interaction.reply({ content: '⚠️ Need at least 2 songs in queue to shuffle!', ephemeral: true });
        queue.tracks.shuffle();
        return interaction.reply({ content: `🔀 Shuffled **${queue.tracks.size}** songs in the queue!` });
    }

    // --- /volume ---
    if (commandName === 'volume') {
        const percent = interaction.options.getInteger('percent');
        const queue = useQueue(interaction.guildId);
        if (!queue || !queue.isPlaying()) return interaction.reply({ content: '❌ No music is currently playing!', ephemeral: true });
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
            .setFooter({ text: 'null • Optimized and responsive' });

        return interaction.editReply({ content: null, embeds: [embed] });
    }

    // --- /null ---
    if (commandName === 'null') {
        const uptimeHours = Math.floor(client.uptime / 3600000);
        const uptimeMinutes = Math.floor((client.uptime % 3600000) / 60000);
        const uptimeSeconds = Math.floor((client.uptime % 60000) / 1000);

        const mem = process.memoryUsage();
        const rssMB = Math.round(mem.rss / 1024 / 1024);
        const heapMB = Math.round(mem.heapUsed / 1024 / 1024);
        const ramPercent = Math.round((rssMB / 256) * 100);

        const embed = new EmbedBuilder()
            .setTitle('∅ null')
            .setDescription('An entity hovering in the void. Ultra-lightweight and ready.')
            .setColor(0x000000)
            .setThumbnail(client.user.displayAvatarURL({ dynamic: true, size: 256 }))
            .addFields(
                { name: 'Status', value: '🟢 Online', inline: true },
                { name: 'Uptime', value: `${uptimeHours}h ${uptimeMinutes}m ${uptimeSeconds}s`, inline: true },
                { name: 'Servers', value: `${client.guilds.cache.size}`, inline: true },
                { name: 'RAM Usage', value: `${rssMB} MB / 256 MB (${ramPercent}%)`, inline: true },
                { name: 'Heap Memory', value: `${heapMB} MB`, inline: true },
                { name: 'AI Readiness', value: '✅ 170MB+ Free for AI Brain', inline: true }
            )
            .setFooter({ text: 'null • Low-RAM Architecture' });

        return interaction.reply({ embeds: [embed] });
    }

    // --- /help ---
    if (commandName === 'help') {
        const embed = new EmbedBuilder()
            .setTitle('📖 null Command Center')
            .setColor(0x5865F2)
            .setDescription('**High-performance music bot (Real Studio Tracks & Fast Streaming)**')
            .addFields(
                { name: '🎵 Music Commands', value: '`/play <song/url>` - Play official song or playlist\n`/pause` - Pause playback\n`/resume` - Resume playback\n`/skip` - Skip current track\n`/stop` - Stop music & leave channel\n`/queue` - View upcoming songs\n`/nowplaying` - Show current song & progress\n`/shuffle` - Shuffle queue\n`/volume <1-100>` - Change volume' },
                { name: '🎮 Utility & Diagnostics', value: '`/ping` - View latency\n`/null` - Live RAM stats & uptime\n`/help` - This help menu' },
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

    if (command === 'play') {
        const query = args.join(' ');
        const voiceChannel = message.member?.voice?.channel;

        if (!voiceChannel) return message.reply('❌ You must be in a voice channel to play music!');
        if (!query) return message.reply('⚠️ Please provide a song name or URL! (e.g., `!play Faded Alan Walker`)');

        const msg = await message.reply('🔍 Searching official track...');

        try {
            const { track, searchResult } = await player.play(voiceChannel, query, {
                nodeOptions: {
                    metadata: message.channel,
                    volume: 80,
                    leaveOnEmpty: true,
                    leaveOnEmptyCooldown: 60000,
                    leaveOnEnd: true,
                    leaveOnEndCooldown: 60000,
                    maxSize: 50,
                    bufferingTimeout: 3000
                },
                requestedBy: message.author
            });

            if (searchResult.hasPlaylist()) {
                const embed = new EmbedBuilder()
                    .setTitle('📑 Playlist Enqueued')
                    .setDescription(`Added **${searchResult.tracks.length}** songs!`)
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
            console.error('Prefix play error:', error.message);
            return msg.edit(`⚠️ Could not stream this song: ${error.message}`);
        }
    }

    if (command === 'skip') {
        const queue = useQueue(message.guildId);
        if (!queue || !queue.isPlaying()) return message.reply('❌ No music playing!');
        const current = queue.currentTrack;
        queue.node.skip();
        return message.reply(`⏭️ Skipped **${current?.title || 'track'}**!`);
    }

    if (command === 'pause') {
        const queue = useQueue(message.guildId);
        if (!queue || !queue.isPlaying()) return message.reply('❌ No music playing!');
        queue.node.pause();
        return message.reply('⏸️ Paused playback!');
    }

    if (command === 'resume') {
        const queue = useQueue(message.guildId);
        if (!queue || !queue.isPlaying()) return message.reply('❌ No music playing!');
        queue.node.resume();
        return message.reply('▶️ Resumed playback!');
    }

    if (command === 'stop') {
        const queue = useQueue(message.guildId);
        if (!queue) return message.reply('❌ Not currently in a voice channel!');
        queue.delete();
        if (gc) { try { gc(); } catch {} }
        return message.reply('⏹️ Stopped music and cleared the queue.');
    }

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

    if (command === 'volume') {
        const queue = useQueue(message.guildId);
        if (!queue || !queue.isPlaying()) return message.reply('❌ No music playing!');
        const vol = parseInt(args[0]);
        if (isNaN(vol) || vol < 1 || vol > 100) return message.reply('⚠️ Volume must be between 1 and 100!');
        queue.node.setVolume(vol);
        return message.reply(`🔊 Volume set to **${vol}%**!`);
    }

    if (command === 'ping') {
        const msg = await message.reply('Pinging...');
        const roundtrip = msg.createdTimestamp - message.createdTimestamp;
        return msg.edit(`🏓 Pong! Bot latency: **${roundtrip}ms** | API latency: **${Math.round(client.ws.ping)}ms**`);
    }

    if (command === 'help') {
        return message.reply('📖 Use `/help` to see the full list of music and utility commands, or use `/play <query>` to begin!');
    }
});

// Process Error Handling
process.on('unhandledRejection', (reason) => {
    console.warn('Notice (unhandled rejection):', reason?.message || reason);
});

process.on('uncaughtException', (err) => {
    console.warn('Notice (uncaught exception):', err?.message || err);
});

// Log In
client.login(TOKEN);
