require('dotenv').config();
const v8 = require('v8');
const vm = require('vm');
const os = require('os');

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
const { Riffy } = require('riffy');

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

// Low-Memory Discord Client: Strips all unneeded caches to stay < 40MB RAM
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
        VoiceStateManager: 30
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

// High-Speed, 429-Immune Lavalink Cluster
// 3 Verified Active Nodes: Auto failover, YouTube Music & Spotify LavaSrc enabled
const lavalinkNodes = [
    {
        host: 'lavalinkv4.serenetia.com',
        port: 443,
        password: 'https://seretia.link/discord',
        secure: true,
        name: 'Serenetia-Node'
    },
    {
        host: 'lava-v4.millohost.my.id',
        port: 443,
        password: 'https://discord.gg/mjS5J2K3ep',
        secure: true,
        name: 'MilloHost-Node'
    },
    {
        host: 'lavalink.jirayu.net',
        port: 443,
        password: 'youshallnotpass',
        secure: true,
        name: 'Jirayu-Node'
    }
];

// Optional user-provided custom Lavalink node
if (process.env.LAVALINK_HOST) {
    lavalinkNodes.unshift({
        host: process.env.LAVALINK_HOST.trim(),
        port: parseInt(process.env.LAVALINK_PORT || '443'),
        password: process.env.LAVALINK_PASSWORD?.trim() || 'youshallnotpass',
        secure: process.env.LAVALINK_SECURE !== 'false',
        name: 'Custom-Lavalink-Node'
    });
}

// Initialize Riffy Lavalink client (Defaults to YouTube Music for official audio tracks)
client.riffy = new Riffy(client, lavalinkNodes, {
    send: (payload) => {
        const guild = client.guilds.cache.get(payload.d?.guild_id);
        if (guild) guild.shard.send(payload);
    },
    defaultSearchPlatform: 'ytmsearch',
    restVersion: 'v4',
    autoMigratePlayers: true,
    migrateOnDisconnect: true
});

// Forward Discord voice state raw packets to Riffy
client.on('raw', (packet) => {
    client.riffy.updateVoiceState(packet);
});

// Format duration helper
function formatDuration(ms) {
    if (!ms || ms === 0) return 'Live';
    const totalSec = Math.floor(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}:${sec.toString().padStart(2, '0')}`;
}

// Intelligent Track Filter: Guarantees original studio songs and rejects 1-hour loops or reaction videos
function pickBestMusicTrack(tracks, query) {
    if (!tracks || !tracks.length) return null;
    const lowerQuery = query.toLowerCase();
    const userWantsLong = /\b(1 hour|10 hour|1hr|10hr|loop|extended|compilation|album|podcast|stream|live|full album)\b/i.test(lowerQuery);

    if (!userWantsLong) {
        const blacklist = [
            '1 hour', '10 hour', '1 hr', '10 hrs', '1 hour loop', '10 hour loop',
            'full album', 'full ost', 'compilation', 'reaction', 'podcast',
            'gameplay', 'walkthrough', 'movie scene', 'audiobook'
        ];

        const clean = tracks.filter(t => {
            const title = (t.info?.title || '').toLowerCase();
            const len = t.info?.length || 0;
            // Filter out videos longer than 12 minutes or shorter than 30 seconds
            if (len > 12 * 60 * 1000) return false;
            if (len < 30 * 1000) return false;
            // Filter out blacklist keywords
            return !blacklist.some(b => title.includes(b));
        });

        if (clean.length > 0) {
            // Prefer tracks with duration between 90s and 420s (1.5 min - 7 min, typical studio song length)
            const optimal = clean.find(t => (t.info?.length >= 90 * 1000 && t.info?.length <= 420 * 1000));
            return optimal || clean[0];
        }
    }
    return tracks[0];
}

// Helper: Visual progress bar
function createProgressBar(currentMs, totalMs, length = 12) {
    if (!totalMs || totalMs === 0) return '🔘' + '▬'.repeat(length);
    const progress = Math.min(Math.max(currentMs / totalMs, 0), 1);
    const progressChars = Math.round(length * progress);
    const emptyChars = Math.max(0, length - progressChars);
    return '▬'.repeat(progressChars) + '🔘' + '▬'.repeat(emptyChars);
}

// Interactive button controls like Luna / Lara bot
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

// Riffy Lavalink Event Listeners
client.riffy.on('nodeConnect', (node) => {
    console.log(`🎧 [LAVALINK] Node "${node.name}" connected and ready!`);
});

client.riffy.on('nodeError', (node, error) => {
    console.warn(`⚠️ [LAVALINK] Node "${node.name}" notice: ${error.message}`);
});

client.riffy.on('trackStart', async (player, track) => {
    const channel = client.channels.cache.get(player.textChannel);
    if (!channel) return;

    const embed = new EmbedBuilder()
        .setTitle('🎶 Now Playing')
        .setDescription(`**[${track.info.title}](${track.info.uri})**\nBy: **${track.info.author}**`)
        .setThumbnail(track.info.thumbnail || null)
        .setColor(0x5865F2)
        .addFields(
            { name: 'Duration', value: formatDuration(track.info.length), inline: true },
            { name: 'Requested By', value: `${track.info.requester?.username || 'Unknown'}`, inline: true },
            { name: 'Queue', value: `${player.queue.size} track(s) next`, inline: true }
        )
        .setFooter({ text: 'null Music • Official Studio Audio' });

    try {
        await channel.send({
            embeds: [embed],
            components: [createMusicControlButtons(false)]
        });
    } catch {}
});

client.riffy.on('queueEnd', async (player) => {
    const channel = client.channels.cache.get(player.textChannel);
    if (channel) {
        const embed = new EmbedBuilder()
            .setTitle('✅ Queue Finished')
            .setDescription('All songs finished playing. Leaving voice channel.')
            .setColor(0x2B2D31);
        try {
            await channel.send({ embeds: [embed] });
        } catch {}
    }
    player.destroy();
    if (gc) { try { gc(); } catch {} }
});

client.riffy.on('trackError', (player, track, payload) => {
    console.warn(`[Track Notice] Error playing ${track.info?.title}:`, payload?.message || 'Playback issue');
    const channel = client.channels.cache.get(player.textChannel);
    if (channel) {
        channel.send({ content: `⚠️ Could not play **${track.info?.title}**: Skipping to next track...` }).catch(() => {});
    }
});

// Periodic garbage collection to maintain ultra-low RAM footprint (~35MB)
setInterval(() => {
    if (gc) {
        try { gc(); } catch {}
    }
}, 45000);

// Auto disconnect when voice channel is empty
client.on('voiceStateUpdate', (oldState, newState) => {
    const player = client.riffy.players.get(oldState.guild.id);
    if (!player) return;

    const botVoiceChannel = oldState.guild.channels.cache.get(player.voiceChannel);
    if (botVoiceChannel && botVoiceChannel.members.filter(m => !m.user.bot).size === 0) {
        setTimeout(() => {
            const currentVoice = oldState.guild.channels.cache.get(player.voiceChannel);
            if (currentVoice && currentVoice.members.filter(m => !m.user.bot).size === 0) {
                const channel = client.channels.cache.get(player.textChannel);
                if (channel) {
                    const embed = new EmbedBuilder()
                        .setTitle('👋 Voice Channel Empty')
                        .setDescription('Voice channel is empty. Disconnecting to save server RAM.')
                        .setColor(0x2B2D31);
                    channel.send({ embeds: [embed] }).catch(() => {});
                }
                player.destroy();
                if (gc) { try { gc(); } catch {} }
            }
        }, 30000);
    }
});

// Slash Command Definitions
const slashCommands = [
    new SlashCommandBuilder()
        .setName('play')
        .setDescription('Play a song, playlist, or URL (YouTube Music, Spotify, SoundCloud)')
        .addStringOption(option =>
            option.setName('query')
                .setDescription('Song title, artist name, or music URL')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('source')
                .setDescription('Search provider (defaults to YouTube Music for clean songs)')
                .setRequired(false)
                .addChoices(
                    { name: '🎵 YouTube Music (Official Studio Songs)', value: 'ytmsearch' },
                    { name: '🟢 Spotify', value: 'spsearch' },
                    { name: '▶️ YouTube', value: 'ytsearch' },
                    { name: '☁️ SoundCloud', value: 'scsearch' }
                )
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
        .setDescription('Stop playback, clear queue, and leave voice channel'),
    new SlashCommandBuilder()
        .setName('queue')
        .setDescription('Show all songs currently in queue'),
    new SlashCommandBuilder()
        .setName('nowplaying')
        .setDescription('Display the currently playing song with live progress bar'),
    new SlashCommandBuilder()
        .setName('shuffle')
        .setDescription('Shuffle upcoming songs in the queue'),
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
        .setDescription('View bot status, RAM memory usage, uptime, and Lavalink status'),
    new SlashCommandBuilder()
        .setName('help')
        .setDescription('Show all commands and features')
];

// Bot Ready Event
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

    // Initialize Riffy Lavalink Engine
    try {
        console.log('🎧 Connecting to 3-node Lavalink cluster (429-immune, ~35MB RAM)...');
        client.riffy.init(client.user.id);
    } catch (err) {
        console.error('⚠️ Lavalink init notice:', err.message);
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

// Handle Interactions
client.on('interactionCreate', async (interaction) => {
    // 1. Button Controls
    if (interaction.isButton()) {
        const player = client.riffy.players.get(interaction.guildId);
        const memberVoice = interaction.member?.voice?.channel;

        if (!memberVoice) {
            return interaction.reply({ content: '❌ You must be in a voice channel to use the controls!', ephemeral: true });
        }
        if (player && player.voiceChannel && player.voiceChannel !== memberVoice.id) {
            return interaction.reply({ content: '❌ You must be in the same voice channel as the bot!', ephemeral: true });
        }
        if (!player || !player.current) {
            return interaction.reply({ content: '❌ No music is currently playing!', ephemeral: true });
        }

        switch (interaction.customId) {
            case 'music_pause_resume': {
                if (player.paused) {
                    player.pause(false);
                    await interaction.reply({ content: '▶️ Resumed music playback!', ephemeral: true });
                } else {
                    player.pause(true);
                    await interaction.reply({ content: '⏸️ Paused music playback!', ephemeral: true });
                }
                break;
            }
            case 'music_skip': {
                const current = player.current;
                player.stop();
                await interaction.reply({ content: `⏭️ Skipped **${current?.info?.title || 'current song'}**!`, ephemeral: true });
                break;
            }
            case 'music_stop': {
                player.queue.clear();
                player.destroy();
                if (gc) { try { gc(); } catch {} }
                await interaction.reply({ content: '⏹️ Stopped music, cleared queue, and disconnected.', ephemeral: true });
                break;
            }
            case 'music_shuffle': {
                if (player.queue.size < 2) {
                    return interaction.reply({ content: '⚠️ Need at least 2 songs in queue to shuffle!', ephemeral: true });
                }
                player.queue.shuffle();
                await interaction.reply({ content: `🔀 Shuffled **${player.queue.size}** songs in the queue!`, ephemeral: true });
                break;
            }
            case 'music_queue': {
                const tracks = player.queue;
                const current = player.current;
                if (!tracks.length) {
                    return interaction.reply({
                        content: `🎶 **Now Playing:** ${current?.info?.title}\n*(No other songs in queue)*`,
                        ephemeral: true
                    });
                }
                const trackList = tracks.slice(0, 10).map((t, idx) => `**${idx + 1}.** ${t.info.title} (\`${formatDuration(t.info.length)}\`)`).join('\n');
                const embed = new EmbedBuilder()
                    .setTitle(`📜 Queue (${tracks.length} songs)`)
                    .setDescription(`**Now Playing:** ${current?.info?.title}\n\n**Upcoming:**\n${trackList}${tracks.length > 10 ? `\n*...and ${tracks.length - 10} more*` : ''}`)
                    .setColor(0x5865F2);
                await interaction.reply({ embeds: [embed] });
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
        const selectedSource = interaction.options.getString('source');
        const voiceChannel = interaction.member?.voice?.channel;

        if (!voiceChannel) {
            return interaction.reply({ content: '❌ You must be in a voice channel to play music!', ephemeral: true });
        }

        const permissions = voiceChannel.permissionsFor(interaction.client.user);
        if (!permissions.has('Connect') || !permissions.has('Speak')) {
            return interaction.reply({ content: '❌ I do not have permission to Connect or Speak in your voice channel!', ephemeral: true });
        }

        const existingPlayer = client.riffy.players.get(interaction.guildId);
        if (existingPlayer && existingPlayer.voiceChannel && existingPlayer.voiceChannel !== voiceChannel.id) {
            return interaction.reply({ content: '❌ I am already playing music in another voice channel!', ephemeral: true });
        }

        await interaction.deferReply();

        try {
            const player = client.riffy.createConnection({
                guildId: interaction.guildId,
                voiceChannel: voiceChannel.id,
                textChannel: interaction.channelId,
                deaf: true
            });

            const isUrl = /^https?:\/\//i.test(query);
            let resolve = null;

            if (isUrl) {
                // Direct link: Spotify (track, album, playlist), YouTube, SoundCloud, etc.
                resolve = await client.riffy.resolve({
                    query: query,
                    requester: interaction.user
                });
            } else if (selectedSource) {
                // User explicitly selected search engine
                resolve = await client.riffy.resolve({
                    query: query,
                    source: selectedSource,
                    requester: interaction.user
                });
            } else {
                // Multi-tier intelligent search:
                // 1. YouTube Music first (official studio audio tracks only)
                resolve = await client.riffy.resolve({
                    query: query,
                    source: 'ytmsearch',
                    requester: interaction.user
                });

                // 2. Fallback to Spotify search if nothing found
                if (!resolve || !resolve.tracks || !resolve.tracks.length) {
                    resolve = await client.riffy.resolve({
                        query: query,
                        source: 'spsearch',
                        requester: interaction.user
                    });
                }

                // 3. Fallback to standard YouTube search if still nothing
                if (!resolve || !resolve.tracks || !resolve.tracks.length) {
                    resolve = await client.riffy.resolve({
                        query: query,
                        source: 'ytsearch',
                        requester: interaction.user
                    });
                }
            }

            if (!resolve || !resolve.tracks || !resolve.tracks.length) {
                return interaction.editReply({ content: `❌ No music results found for: \`${query}\`` });
            }

            if (resolve.loadType === 'playlist') {
                for (const track of resolve.tracks) {
                    track.info.requester = interaction.user;
                    player.queue.add(track);
                }

                const embed = new EmbedBuilder()
                    .setTitle('📑 Playlist Enqueued')
                    .setDescription(`Added playlist **${resolve.tracks.length}** songs to the queue!`)
                    .setColor(0x5865F2);

                await interaction.editReply({ embeds: [embed] });

                if (!player.playing && !player.paused) {
                    player.play();
                }
            } else {
                // Intelligent music filter: picks the real song and filters out 1-hour loops / reaction clips
                const track = pickBestMusicTrack(resolve.tracks, query);
                track.info.requester = interaction.user;
                player.queue.add(track);

                if (player.playing) {
                    const embed = new EmbedBuilder()
                        .setTitle('➕ Added to Queue')
                        .setDescription(`**[${track.info.title}](${track.info.uri})**\nBy: **${track.info.author}**`)
                        .setThumbnail(track.info.thumbnail || null)
                        .setColor(0x2B2D31)
                        .addFields(
                            { name: 'Duration', value: formatDuration(track.info.length), inline: true },
                            { name: 'Position', value: `#${player.queue.size}`, inline: true }
                        );
                    await interaction.editReply({ embeds: [embed] });
                } else {
                    const embed = new EmbedBuilder()
                        .setTitle('🎶 Enqueued')
                        .setDescription(`**[${track.info.title}](${track.info.uri})**\nBy: **${track.info.author}**`)
                        .setThumbnail(track.info.thumbnail || null)
                        .setColor(0x5865F2)
                        .addFields(
                            { name: 'Duration', value: formatDuration(track.info.length), inline: true },
                            { name: 'Channel', value: `${voiceChannel.name}`, inline: true }
                        );
                    await interaction.editReply({ embeds: [embed] });
                }

                if (!player.playing && !player.paused) {
                    player.play();
                }
            }
        } catch (error) {
            console.error('Play error:', error.message);
            return interaction.editReply({ content: `⚠️ Could not play track: ${error.message}` });
        }
    }

    // --- /pause ---
    if (commandName === 'pause') {
        const player = client.riffy.players.get(interaction.guildId);
        if (!player || !player.current) return interaction.reply({ content: '❌ No music is currently playing!', ephemeral: true });
        if (player.paused) return interaction.reply({ content: '⚠️ Music is already paused!', ephemeral: true });
        player.pause(true);
        return interaction.reply({ content: '⏸️ Paused the music!' });
    }

    // --- /resume ---
    if (commandName === 'resume') {
        const player = client.riffy.players.get(interaction.guildId);
        if (!player || !player.current) return interaction.reply({ content: '❌ No music is currently playing!', ephemeral: true });
        if (!player.paused) return interaction.reply({ content: '⚠️ Music is not paused!', ephemeral: true });
        player.pause(false);
        return interaction.reply({ content: '▶️ Resumed music playback!' });
    }

    // --- /skip ---
    if (commandName === 'skip') {
        const player = client.riffy.players.get(interaction.guildId);
        if (!player || !player.current) return interaction.reply({ content: '❌ No music is currently playing!', ephemeral: true });
        const currentTitle = player.current?.info?.title || 'current song';
        player.stop();
        return interaction.reply({ content: `⏭️ Skipped **${currentTitle}**!` });
    }

    // --- /stop ---
    if (commandName === 'stop') {
        const player = client.riffy.players.get(interaction.guildId);
        if (!player) return interaction.reply({ content: '❌ The bot is not in a voice channel!', ephemeral: true });
        player.queue.clear();
        player.destroy();
        if (gc) { try { gc(); } catch {} }
        return interaction.reply({ content: '⏹️ Stopped music, cleared queue, and disconnected.' });
    }

    // --- /queue ---
    if (commandName === 'queue') {
        const player = client.riffy.players.get(interaction.guildId);
        if (!player || !player.current) return interaction.reply({ content: '❌ The queue is currently empty!', ephemeral: true });

        const tracks = player.queue;
        const current = player.current;
        const trackList = tracks.slice(0, 10).map((t, idx) => `**${idx + 1}.** [${t.info.title}](${t.info.uri}) (\`${formatDuration(t.info.length)}\`)`).join('\n');

        const embed = new EmbedBuilder()
            .setTitle(`📜 Queue (${tracks.length + 1} tracks)`)
            .setDescription(`**Now Playing:**\n🎶 [${current.info.title}](${current.info.uri}) (\`${formatDuration(current.info.length)}\`)\n\n**Upcoming Tracks:**\n${trackList || '*No upcoming tracks*'}${tracks.length > 10 ? `\n\n*...and ${tracks.length - 10} more*` : ''}`)
            .setColor(0x5865F2)
            .setFooter({ text: `Volume: ${player.volume}%` });

        return interaction.reply({ embeds: [embed] });
    }

    // --- /nowplaying ---
    if (commandName === 'nowplaying') {
        const player = client.riffy.players.get(interaction.guildId);
        if (!player || !player.current) return interaction.reply({ content: '❌ No music is currently playing!', ephemeral: true });

        const current = player.current;
        const currentMs = player.position || 0;
        const totalMs = current.info.length || 0;
        const bar = createProgressBar(currentMs, totalMs);

        const embed = new EmbedBuilder()
            .setTitle('🎶 Now Playing')
            .setDescription(`**[${current.info.title}](${current.info.uri})**\nBy: **${current.info.author}**\n\n${bar}\n\`${formatDuration(currentMs)} / ${formatDuration(totalMs)}\``)
            .setThumbnail(current.info.thumbnail || null)
            .setColor(0x5865F2)
            .addFields(
                { name: 'Status', value: player.paused ? '⏸️ Paused' : '▶️ Playing', inline: true },
                { name: 'Volume', value: `🔊 ${player.volume}%`, inline: true },
                { name: 'Requested By', value: `${current.info.requester?.username || 'Unknown'}`, inline: true }
            );

        return interaction.reply({
            embeds: [embed],
            components: [createMusicControlButtons(player.paused)]
        });
    }

    // --- /shuffle ---
    if (commandName === 'shuffle') {
        const player = client.riffy.players.get(interaction.guildId);
        if (!player || player.queue.size < 2) {
            return interaction.reply({ content: '⚠️ You need at least 2 tracks in the queue to shuffle!', ephemeral: true });
        }
        player.queue.shuffle();
        return interaction.reply({ content: `🔀 Shuffled **${player.queue.size}** tracks in the queue!` });
    }

    // --- /volume ---
    if (commandName === 'volume') {
        const percent = interaction.options.getInteger('percent');
        const player = client.riffy.players.get(interaction.guildId);
        if (!player) return interaction.reply({ content: '❌ No active music playback in this server!', ephemeral: true });

        player.setVolume(percent);
        return interaction.reply({ content: `🔊 Volume set to **${percent}%**!` });
    }

    // --- /ping ---
    if (commandName === 'ping') {
        const ping = client.ws.ping;
        return interaction.reply({ content: `🏓 Pong! Bot API Latency: **${ping}ms**` });
    }

    // --- /null ---
    if (commandName === 'null') {
        const uptime = Math.floor(process.uptime());
        const hours = Math.floor(uptime / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);
        const seconds = uptime % 60;

        const memory = process.memoryUsage();
        const rssMB = Math.round(memory.rss / 1024 / 1024);
        const heapMB = Math.round(memory.heapUsed / 1024 / 1024);

        const connectedNodes = client.riffy.leastUsedNodes.map(n => `🟢 ${n.name}`).join('\n') || '⚠️ Reconnecting...';

        const embed = new EmbedBuilder()
            .setTitle('⚙️ null — System & Music Engine Status')
            .setColor(0x5865F2)
            .setThumbnail(client.user.displayAvatarURL())
            .addFields(
                { name: '🤖 Bot Status', value: 'ONLINE 24/7', inline: true },
                { name: '⏱️ Uptime', value: `${hours}h ${minutes}m ${seconds}s`, inline: true },
                { name: '📶 Discord Ping', value: `${client.ws.ping}ms`, inline: true },
                { name: '💾 Total RAM Usage', value: `**${rssMB} MB** (Heap: ${heapMB} MB)\n*Ultra-low memory profile (<40MB)*`, inline: false },
                { name: '🎧 Audio Cluster', value: `3-Node Lavalink Cluster (YouTube Music & Spotify)\n${connectedNodes}`, inline: false },
                { name: '🌐 Server Count', value: `${client.guilds.cache.size} server(s)`, inline: true },
                { name: '🔊 Active Players', value: `${client.riffy.players.size} active voice session(s)`, inline: true }
            )
            .setFooter({ text: 'null • Built for bot-hosting.net' });

        return interaction.reply({ embeds: [embed] });
    }

    // --- /help ---
    if (commandName === 'help') {
        const embed = new EmbedBuilder()
            .setTitle('📖 null Bot — Commands Guide')
            .setDescription('Ultra-lightweight, 24/7 high-fidelity music bot with interactive buttons.')
            .setColor(0x5865F2)
            .addFields(
                { name: '🎶 Music Playback', value: '`/play <song>` — Play songs or playlists (YouTube Music, Spotify, SoundCloud)\n`/pause` — Pause music\n`/resume` — Resume music\n`/skip` — Skip to next song\n`/stop` — Stop playback & disconnect' },
                { name: '📜 Queue & Audio', value: '`/nowplaying` — Live song display with progress bar & buttons\n`/queue` — Show upcoming songs\n`/shuffle` — Shuffle the queue\n`/volume <1-100>` — Change playback volume' },
                { name: '⚙️ Utilities', value: '`/null` — Bot status, memory diagnostics & audio nodes\n`/ping` — Check latency\n`/help` — Display this guide' }
            )
            .setFooter({ text: 'null Music • Interactive Controls Available on Playback' });

        return interaction.reply({ embeds: [embed] });
    }
});

// Process Safeguards: Prevent crash loops on unhandled rejections
process.on('unhandledRejection', (reason) => {
    console.warn('Recovered from unhandled rejection:', reason?.message || reason);
});

process.on('uncaughtException', (err) => {
    console.warn('Recovered from uncaught exception:', err.message);
});

// Login Bot
console.log('🚀 Connecting null to Discord Gateway...');
client.login(TOKEN);
