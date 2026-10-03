require('dotenv').config();
const {
    Client,
    GatewayIntentBits,
    ActivityType,
    EmbedBuilder,
    REST,
    Routes,
    SlashCommandBuilder
} = require('discord.js');

// Verify token presence
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

// Initialize client with necessary intents
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// Define Slash Commands
const slashCommands = [
    new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Check the bot latency and responsiveness'),
    new SlashCommandBuilder()
        .setName('null')
        .setDescription('Learn about the null entity'),
    new SlashCommandBuilder()
        .setName('help')
        .setDescription('Show all available commands')
];

// When the bot successfully connects to Discord
client.once('ready', async () => {
    console.log('======================================================');
    console.log(`✅ [ONLINE] Logged in as: ${client.user.tag}`);
    console.log(`🆔 Bot ID: ${client.user.id}`);
    console.log(`🌐 Connected to ${client.guilds.cache.size} server(s)`);
    console.log('======================================================');

    // Set online presence & activity
    const activityName = process.env.BOT_STATUS || 'null';
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
        console.log(`✨ Presence status set to: ONLINE (${activityName})`);
    } catch (err) {
        console.warn('⚠️ Could not set custom activity, falling back to playing status:', err.message);
        client.user.setPresence({
            activities: [{ name: activityName, type: ActivityType.Playing }],
            status: 'online'
        });
    }

    // Register slash commands globally
    try {
        console.log('🔄 Registering global slash commands...');
        await client.application.commands.set(slashCommands);
        console.log('✅ Global slash commands registered successfully (/ping, /null, /help)');
    } catch (error) {
        console.error('⚠️ Failed to register global slash commands:', error.message);
    }
});

// Handle Slash Command Interactions
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;

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
            .setFooter({ text: 'null • Online and responsive' })
            .setTimestamp();

        await interaction.editReply({ content: null, embeds: [embed] });
    } else if (commandName === 'null') {
        const uptimeHours = Math.floor(client.uptime / 3600000);
        const uptimeMinutes = Math.floor((client.uptime % 3600000) / 60000);
        const uptimeSeconds = Math.floor((client.uptime % 60000) / 1000);

        const embed = new EmbedBuilder()
            .setTitle('∅ null')
            .setDescription('An entity hovering in the void. Ready, online, and watchful.')
            .setColor(0x000000)
            .setThumbnail(client.user.displayAvatarURL({ dynamic: true, size: 256 }))
            .addFields(
                { name: 'Status', value: '🟢 Online', inline: true },
                { name: 'Uptime', value: `${uptimeHours}h ${uptimeMinutes}m ${uptimeSeconds}s`, inline: true },
                { name: 'Servers', value: `${client.guilds.cache.size}`, inline: true }
            )
            .setFooter({ text: 'null' })
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    } else if (commandName === 'help') {
        const embed = new EmbedBuilder()
            .setTitle('📖 null Command List')
            .setColor(0x5865F2)
            .setDescription('Here are the commands you can use:')
            .addFields(
                { name: '/ping or !ping', value: 'Check connection latency and response time' },
                { name: '/null or !null', value: 'View status, avatar, and system info' },
                { name: '/help or !help', value: 'Display this help message' }
            )
            .setFooter({ text: 'null Discord Bot' })
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    }
});

// Prefix command support (!ping, !null, !help)
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.content) return;

    const prefix = '!';
    if (!message.content.startsWith(prefix)) return;

    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const command = args.shift()?.toLowerCase();

    if (command === 'ping') {
        const msg = await message.reply('Pinging...');
        const roundtripLatency = msg.createdTimestamp - message.createdTimestamp;
        const apiLatency = Math.round(client.ws.ping);

        const embed = new EmbedBuilder()
            .setTitle('🏓 Pong!')
            .setColor(0x2B2D31)
            .addFields(
                { name: 'Bot Latency', value: `${roundtripLatency}ms`, inline: true },
                { name: 'API Latency', value: `${apiLatency}ms`, inline: true }
            )
            .setFooter({ text: 'null • Online and responsive' })
            .setTimestamp();

        await msg.edit({ content: null, embeds: [embed] });
    } else if (command === 'null') {
        const uptimeHours = Math.floor(client.uptime / 3600000);
        const uptimeMinutes = Math.floor((client.uptime % 3600000) / 60000);
        const uptimeSeconds = Math.floor((client.uptime % 60000) / 1000);

        const embed = new EmbedBuilder()
            .setTitle('∅ null')
            .setDescription('An entity hovering in the void. Ready, online, and watchful.')
            .setColor(0x000000)
            .setThumbnail(client.user.displayAvatarURL({ dynamic: true, size: 256 }))
            .addFields(
                { name: 'Status', value: '🟢 Online', inline: true },
                { name: 'Uptime', value: `${uptimeHours}h ${uptimeMinutes}m ${uptimeSeconds}s`, inline: true },
                { name: 'Servers', value: `${client.guilds.cache.size}`, inline: true }
            )
            .setFooter({ text: 'null' })
            .setTimestamp();

        await message.reply({ embeds: [embed] });
    } else if (command === 'help') {
        const embed = new EmbedBuilder()
            .setTitle('📖 null Command List')
            .setColor(0x5865F2)
            .setDescription('Here are the commands you can use:')
            .addFields(
                { name: '!ping or /ping', value: 'Check connection latency and response time' },
                { name: '!null or /null', value: 'View status, avatar, and system info' },
                { name: '!help or /help', value: 'Display this help message' }
            )
            .setFooter({ text: 'null Discord Bot' })
            .setTimestamp();

        await message.reply({ embeds: [embed] });
    }
});

// Process error handling
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

// Login
client.login(TOKEN);
