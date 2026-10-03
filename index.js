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

// Low-Memory Discord Client: Strips unneeded caches to maintain ~35MB RAM
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ],
    makeCache: Options.cacheWithLimits({
        ApplicationCommandManager: 0,
        BaseGuildEmojiManager: 0,
        GuildBanManager: 0,
        GuildInviteManager: 0,
        GuildMemberManager: 50,
        GuildStickerManager: 0,
        GuildScheduledEventManager: 0,
        MessageManager: 0,
        PresenceManager: 0,
        ReactionManager: 0,
        ReactionUserManager: 0,
        StageInstanceManager: 0,
        ThreadManager: 0,
        ThreadMemberManager: 0,
        UserManager: 20,
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

// High-Speed, 429-Immune Lavalink Nodes
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

// Initialize Riffy Lavalink client
client.riffy = new Riffy(client, lavalinkNodes, {
    send: (payload) => {
        const guild = client.guilds.cache.get(payload.d?.guild_id);
        if (guild) guild.shard.send(payload);
    },
    defaultSearchPlatform: 'ytsearch',
    restVersion: 'v4',
    autoMigratePlayers: true,
    migrateOnDisconnect: true
});

// Forward Discord voice state raw packets to Riffy
client.on('raw', (packet) => {
    client.riffy.updateVoiceState(packet);
});

// ==========================================
// 🧠 AI BRAIN ENGINE & CONVERSATION MEMORY
// ==========================================

// Lightweight In-Memory Channel Conversation History (Max 50 messages)
// Map<channelId, Array<{ role: 'user' | 'model', text: string, name: string, timestamp: number }>>
const conversationHistories = new Map();

function addMessageToHistory(channelId, role, text, name) {
    if (!conversationHistories.has(channelId)) {
        conversationHistories.set(channelId, []);
    }
    const history = conversationHistories.get(channelId);
    history.push({
        role,
        text: text.slice(0, 1500),
        name: name || (role === 'model' ? 'null' : 'User'),
        timestamp: Date.now()
    });
    if (history.length > 50) {
        history.shift();
    }
}

// Prune inactive channel histories every 5 minutes to keep RAM < 40MB
setInterval(() => {
    const now = Date.now();
    for (const [chId, hist] of conversationHistories.entries()) {
        const lastMsg = hist[hist.length - 1];
        if (!lastMsg || (now - lastMsg.timestamp > 2 * 60 * 60 * 1000)) {
            conversationHistories.delete(chId);
        }
    }
    if (gc) { try { gc(); } catch {} }
}, 300000);

// Helper: Inspect server context, members, and roles for the AI
function buildServerContext(message) {
    if (!message.guild) return 'Context: Direct Message with User.';

    const guild = message.guild;
    const author = message.author;
    const member = message.member;

    // Speaker's roles
    const authorRoles = member?.roles?.cache
        .filter(r => r.name !== '@everyone')
        .map(r => r.name)
        .join(', ') || 'None';

    // Server roles summary
    const serverRoles = guild.roles.cache
        .filter(r => r.name !== '@everyone')
        .map(r => r.name)
        .slice(0, 30)
        .join(', ');

    // Mentioned users info
    let mentionedUsers = '';
    if (message.mentions.members && message.mentions.members.size > 0) {
        const list = message.mentions.members
            .filter(m => m.id !== client.user.id)
            .map(m => {
                const r = m.roles.cache.filter(role => role.name !== '@everyone').map(role => role.name).join(', ') || 'None';
                return `- User: ${m.user.username} (Nickname: ${m.displayName}, ID: ${m.id}), Roles: [${r}], Joined: ${m.joinedAt?.toDateString() || 'Unknown'}`;
            });
        if (list.length > 0) {
            mentionedUsers = `\nMentioned Users in Message:\n${list.join('\n')}`;
        }
    }

    // Cached members sample
    const membersSample = guild.members.cache
        .filter(m => !m.user.bot)
        .map(m => {
            const r = m.roles.cache.filter(role => role.name !== '@everyone').map(role => role.name).join(', ') || 'None';
            return `${m.displayName} (@${m.user.username}, Roles: [${r}])`;
        })
        .slice(0, 30)
        .join('; ');

    return `Discord Server Context:
- Server Name: "${guild.name}" (ID: ${guild.id})
- Owner ID: <@${guild.ownerId}>
- Total Members: ${guild.memberCount}
- Server Roles: [${serverRoles || 'None'}]
- Current Channel: #${message.channel.name || 'chat'} (ID: ${message.channel.id})
- Current Speaker: ${member?.displayName || author.username} (@${author.tag}, ID: ${author.id})
- Speaker Roles: [${authorRoles}]
- Speaker Joined Server: ${member?.joinedAt?.toDateString() || 'Unknown'}
- Speaker Account Created: ${author.createdAt.toDateString()}
${mentionedUsers}
- Server Members (sample): ${membersSample || 'None'}`;
}

// Helper: Split long Discord responses into chunks <= 1950 characters
function splitDiscordMessage(text, maxLen = 1950) {
    if (text.length <= maxLen) return [text];
    const chunks = [];
    let current = '';
    for (const line of text.split('\n')) {
        if ((current + '\n' + line).length > maxLen) {
            if (current) chunks.push(current);
            current = line;
        } else {
            current = current ? current + '\n' + line : line;
        }
    }
    if (current) chunks.push(current);
    return chunks;
}

// Intelligent Search Query Extractor: Cleans conversational filler words
function extractSearchQuery(prompt) {
    let clean = prompt.replace(/<@!?\d+>/g, '').trim();
    clean = clean.replace(/^(can you |could you |please |hey |null,?\s*|bot,?\s*)*/i, '');
    clean = clean.replace(/^(search( the web)?( for)?|look up|google|find( out)?( about)?|tell me( about)?|what is|who is)\s+/i, '');
    return clean.replace(/[?!.]+$/, '').trim() || prompt.trim();
}

// Multi-Source Live Web Search (DuckDuckGo Instant Answers + Wikipedia + Google News)
async function searchWeb(query) {
    const results = [];

    // 1. DuckDuckGo Instant Answer
    try {
        const ddgRes = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`, {
            headers: { 'User-Agent': 'null-discord-bot/1.0' },
            signal: AbortSignal.timeout(3000)
        });
        if (ddgRes.ok) {
            const data = await ddgRes.json();
            if (data.Abstract) {
                results.push(`- [Web Summary]: ${data.Abstract}`);
            } else if (data.RelatedTopics?.[0]?.Text) {
                results.push(`- [Web Summary]: ${data.RelatedTopics[0].Text}`);
            }
        }
    } catch {}

    // 2. Wikipedia Search API
    try {
        const wikiUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&utf8=`;
        const wikiRes = await fetch(wikiUrl, { signal: AbortSignal.timeout(3000) });
        if (wikiRes.ok) {
            const data = await wikiRes.json();
            const snippets = data.query?.search?.slice(0, 2) || [];
            for (const s of snippets) {
                const cleanSnippet = s.snippet.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"');
                results.push(`- [Wikipedia]: ${s.title}: ${cleanSnippet}`);
            }
        }
    } catch {}

    // 3. Google News & Live RSS Search
    try {
        const newsUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
        const newsRes = await fetch(newsUrl, { signal: AbortSignal.timeout(3000) });
        if (newsRes.ok) {
            const xml = await newsRes.text();
            const items = [...xml.matchAll(/<title>([^<]+)<\/title>[\s\S]*?<pubDate>([^<]+)<\/pubDate>/g)].slice(1, 4);
            for (const item of items) {
                results.push(`- [Live News]: ${item[1]} (${item[2]})`);
            }
        }
    } catch {}

    return results.join('\n');
}

// ==========================================
// 🧠 MULTI-PROVIDER AI ROTATION & AUTO-FALLBACK ENGINE
// ==========================================

let aiRotationIndex = 0;
const aiCooldowns = {
    groq: 0,
    openrouter: 0,
    gemini: 0
};

// 1. Groq Cloud Engine (14,400 req/day - Blazing Fast)
async function callGroq(groqKey, systemInstructionText, history, prompt) {
    const models = [
        'openai/gpt-oss-120b',
        'qwen/qwen3.8-27b',
        'openai/gpt-oss-20b',
        'llama-3.3-70b-versatile',
        'llama-3.1-8b-instant'
    ];

    const messages = [{ role: 'system', content: systemInstructionText }];
    for (const h of history) {
        messages.push({
            role: h.role === 'model' ? 'assistant' : 'user',
            content: h.role === 'user' ? `[${h.name}]: ${h.text}` : h.text
        });
    }
    messages.push({ role: 'user', content: prompt });

    let lastErr = null;
    for (const model of models) {
        try {
            const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${groqKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: model,
                    messages: messages,
                    max_tokens: 600
                })
            });

            if (res.status === 429) {
                const err = new Error('Groq rate limited (429)');
                err.status = 429;
                err.isRateLimit = true;
                throw err;
            }

            const data = await res.json();
            if (res.ok && data.choices?.[0]?.message?.content) {
                return data.choices[0].message.content.trim();
            }

            lastErr = new Error(data.error?.message || `Groq error on ${model}`);
            if (data.error?.code === 'rate_limit_exceeded') {
                const err = new Error(data.error?.message || 'Groq rate limited');
                err.status = 429;
                err.isRateLimit = true;
                throw err;
            }
        } catch (e) {
            if (e.isRateLimit || e.status === 429) throw e;
            lastErr = e;
        }
    }
    throw lastErr || new Error('All Groq models failed');
}

// 2. OpenRouter Engine (Multi-model free tier with 429 detection)
async function callOpenRouter(openrouterKey, systemInstructionText, history, prompt) {
    const messages = [{ role: 'system', content: systemInstructionText }];
    for (const h of history) {
        messages.push({
            role: h.role === 'model' ? 'assistant' : 'user',
            content: h.role === 'user' ? `[${h.name}]: ${h.text}` : h.text
        });
    }
    messages.push({ role: 'user', content: prompt });

    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${openrouterKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            models: [
                'qwen/qwen3.8-27b:free',
                'nvidia/nemotron-3.5-lightning:free',
                'liquid/lfm-2.5-2.6b:free',
                'google/gemma-2-9b-it:free'
            ],
            messages: messages,
            max_tokens: 600
        })
    });

    if (res.status === 429) {
        const err = new Error('OpenRouter 429 rate limit exceeded');
        err.status = 429;
        err.isRateLimit = true;
        throw err;
    }

    const data = await res.json();
    if (!res.ok) {
        const err = new Error(data.error?.message || `OpenRouter error (${res.status})`);
        if (data.error?.code === 429 || err.message.toLowerCase().includes('rate limit')) {
            err.status = 429;
            err.isRateLimit = true;
        }
        throw err;
    }

    const reply = data.choices?.[0]?.message?.content;
    if (reply) return reply.trim();
    throw new Error('OpenRouter returned empty choices');
}

// 3. Google Gemini Engine (1,500 req/day + Native Google Search Grounding)
async function callGemini(geminiKey, systemInstructionText, history, prompt) {
    const contents = [];
    for (const h of history) {
        contents.push({
            role: h.role === 'model' ? 'model' : 'user',
            parts: [{ text: h.role === 'user' ? `[${h.name}]: ${h.text}` : h.text }]
        });
    }
    contents.push({
        role: 'user',
        parts: [{ text: prompt }]
    });

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`;
    const payload = {
        systemInstruction: { parts: [{ text: systemInstructionText }] },
        contents: contents,
        tools: [{ googleSearch: {} }],
        generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 1000
        }
    };

    let response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        delete payload.tools;
        response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    }

    if (response.status === 429) {
        const err = new Error('Gemini 429 rate limit exceeded');
        err.status = 429;
        err.isRateLimit = true;
        throw err;
    }

    if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        const err = new Error(errData.error?.message || `Gemini error (${response.status})`);
        if (response.status === 429 || err.message.toLowerCase().includes('quota') || err.message.toLowerCase().includes('rate')) {
            err.status = 429;
            err.isRateLimit = true;
        }
        throw err;
    }

    const data = await response.json();
    const replyText = data.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
    if (replyText) return replyText.trim();
    throw new Error('Gemini returned empty candidate');
}

// Main AI Handler: Rotates healthy providers and automatically cascades/falls back on error
async function generateAIResponse(prompt, channelId, serverContext) {
    const groqKey = process.env.GROQ_API_KEY?.trim();
    const openrouterKey = process.env.OPENROUTER_API_KEY?.trim();
    const geminiKey = process.env.GEMINI_API_KEY?.trim();

    const configuredProviders = [];
    if (groqKey) configuredProviders.push('groq');
    if (openrouterKey) configuredProviders.push('openrouter');
    if (geminiKey) configuredProviders.push('gemini');

    if (configuredProviders.length === 0) {
        return `👋 **Hey! My AI brain is ready, but I need an AI token to activate my thoughts!**

🔑 **How to add your API key**:
In your **bot-hosting.net** panel:
- Open \`.env\` in **File Manager** (or Environment Variables)
- Add: \`GROQ_API_KEY=your_key_here\` (or \`OPENROUTER_API_KEY\`, \`GEMINI_API_KEY\`)
- Click **Save** and **Restart**!`;
    }

    const history = conversationHistories.get(channelId) || [];

    // Real-Time Web Search Trigger & Extraction
    let liveWebContext = '';
    let executedSearchQuery = null;
    const wantsSearch = /\b(search|look up|google|who|what|when|where|why|how|news|latest|today|recent|update|price|release|weather|score|game|film|movie)\b/i.test(prompt);

    if (wantsSearch) {
        executedSearchQuery = extractSearchQuery(prompt);
        if (executedSearchQuery) {
            const findings = await searchWeb(executedSearchQuery);
            if (findings) {
                liveWebContext = `\nREAL-TIME LIVE WEB SEARCH RESULTS for "${executedSearchQuery}":\n${findings}\n(Use these verified real-time web search facts to answer accurately. Cite the facts!)\n`;
            }
        }
    }

    const systemInstructionText = `You are "null", an advanced, witty, highly intelligent, and helpful AI assistant living inside a Discord server.
${serverContext}
${liveWebContext}
Core Personality & Capabilities:
- You have pair-programming capabilities, deep technical knowledge, and sharp conversational skills.
- You have live internet access to search the web and check current facts, news, and real-time information.
- You remember the previous 50 messages of conversation in this channel.
- You can see members, their roles, server information, and details about who is speaking to you.
- Answer helpfully, naturally, and concisely for Discord chat. Use code blocks for code and bold for emphasis.
- Do not mention that you are a system prompt; just talk naturally as null.`;

    // Smart Rotation & Fallback Order
    const now = Date.now();
    const available = configuredProviders.filter(p => !aiCooldowns[p] || aiCooldowns[p] <= now);
    const candidates = available.length > 0 ? available : [...configuredProviders];

    const startIndex = (aiRotationIndex++) % candidates.length;
    const executionOrder = [
        ...candidates.slice(startIndex),
        ...candidates.slice(0, startIndex)
    ];
    for (const p of configuredProviders) {
        if (!executionOrder.includes(p)) executionOrder.push(p);
    }

    let lastError = null;
    let rateLimitHit = false;

    for (const provider of executionOrder) {
        try {
            let reply = null;
            if (provider === 'groq') {
                reply = await callGroq(groqKey, systemInstructionText, history, prompt);
            } else if (provider === 'openrouter') {
                reply = await callOpenRouter(openrouterKey, systemInstructionText, history, prompt);
            } else if (provider === 'gemini') {
                reply = await callGemini(geminiKey, systemInstructionText, history, prompt);
            }

            if (reply && reply.trim().length > 0) {
                aiCooldowns[provider] = 0; // Mark healthy
                if (executedSearchQuery && liveWebContext && !reply.includes('Searched the web for:')) {
                    reply += `\n\n🌐 *Searched the web for: "${executedSearchQuery}"*`;
                }
                return reply;
            }
        } catch (err) {
            lastError = err;
            if (err.isRateLimit || err.status === 429) {
                rateLimitHit = true;
                aiCooldowns[provider] = Date.now() + (5 * 60 * 1000); // 5-minute cooldown
                console.warn(`⚠️ [AI Rotation] Provider "${provider}" reached rate limit / quota (429). Falling back to next available provider...`);
            } else {
                aiCooldowns[provider] = Date.now() + (30 * 1000); // 30-second error cooldown
                console.warn(`⚠️ [AI Rotation] Provider "${provider}" notice: ${err.message}. Falling back to next available provider...`);
            }
        }
    }

    if (rateLimitHit) {
        return `⚠️ **All configured AI providers (${configuredProviders.join(', ')}) have hit their rate limits or daily quotas.**\n` +
               `The bot rotated and attempted fallback across all keys. Please wait a few moments for quota refresh!`;
    }

    return `⚠️ Could not generate an AI response right now (${lastError?.message || 'Unknown provider issue'}).`;
}

// ==========================================
// 🎵 MUSIC HELPERS & CONTROLS
// ==========================================

function formatDuration(ms) {
    if (!ms || ms === 0) return 'Live';
    const totalSec = Math.floor(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}:${sec.toString().padStart(2, '0')}`;
}

function createProgressBar(currentMs, totalMs, length = 12) {
    if (!totalMs || totalMs === 0) return '🔘' + '▬'.repeat(length);
    const progress = Math.min(Math.max(currentMs / totalMs, 0), 1);
    const progressChars = Math.round(length * progress);
    const emptyChars = Math.max(0, length - progressChars);
    return '▬'.repeat(progressChars) + '🔘' + '▬'.repeat(emptyChars);
}

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
        .setFooter({ text: 'null Music • Clean Audio' });

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
        .setDescription('Play a song, playlist, or URL (YouTube, Spotify, SoundCloud)')
        .addStringOption(option =>
            option.setName('query')
                .setDescription('Song title, artist name, or song URL')
                .setRequired(true)
        ),
    new SlashCommandBuilder()
        .setName('ask')
        .setDescription('Ask the null AI brain anything (web search & reasoning enabled)')
        .addStringOption(option =>
            option.setName('question')
                .setDescription('What do you want to ask null?')
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
        .setDescription('View bot status, RAM memory usage, AI brain, and Lavalink status'),
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
    const activityName = process.env.BOT_STATUS || 'null • @null to chat';
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
        console.log('🎧 Connecting to high-speed Lavalink nodes (429-immune, ~35MB RAM)...');
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

// ==========================================
// 💬 CHAT & MENTION AI TRIGGER
// ==========================================
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // Check if bot was mentioned (@null)
    const isMentioned = message.mentions.users.has(client.user.id) && !message.mentions.everyone && !message.content.includes('@here');

    // Check if user replied to null's previous message
    let isReplyToBot = false;
    if (message.reference && message.reference.messageId) {
        try {
            const repliedMessage = await message.channel.messages.fetch(message.reference.messageId).catch(() => null);
            if (repliedMessage && repliedMessage.author.id === client.user.id) {
                isReplyToBot = true;
            }
        } catch {}
    }

    // Allow DMs as well
    const isDM = !message.guild;

    if (!isMentioned && !isReplyToBot && !isDM) return;

    // Remove @mention from prompt text
    const botMentionRegex = new RegExp(`<@!?${client.user.id}>`, 'g');
    const cleanPrompt = message.content.replace(botMentionRegex, '').trim() || 'Hello!';

    const speakerName = message.member?.displayName || message.author.username;

    // Show typing status in Discord
    try {
        await message.channel.sendTyping();
    } catch {}

    try {
        // Fetch a small batch of guild members to ensure member context is fresh
        if (message.guild && message.guild.members.cache.size < 20) {
            await message.guild.members.fetch({ limit: 50 }).catch(() => {});
        }

        const serverContext = buildServerContext(message);

        // Generate AI response
        const aiReply = await generateAIResponse(cleanPrompt, message.channel.id, serverContext);

        // Store user message & bot reply in 50-message conversational memory
        addMessageToHistory(message.channel.id, 'user', cleanPrompt, speakerName);
        addMessageToHistory(message.channel.id, 'model', aiReply, 'null');

        // Split message if > 1950 characters
        const chunks = splitDiscordMessage(aiReply);
        for (let i = 0; i < chunks.length; i++) {
            if (i === 0) {
                await message.reply({ content: chunks[i], allowedMentions: { repliedUser: false } });
            } else {
                await message.channel.send({ content: chunks[i] });
            }
        }
    } catch (err) {
        console.error('AI chat error:', err.message);
        await message.reply({
            content: `⚠️ Oops, I encountered an issue thinking about that: \`${err.message}\``,
            allowedMentions: { repliedUser: false }
        }).catch(() => {});
    }
});

// Handle Slash Command & Button Interactions
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
                await interaction.reply({ embeds: [embed], ephemeral: true });
                break;
            }
        }
        return;
    }

    // 2. Chat Input Commands
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;

    // --- /ask ---
    if (commandName === 'ask') {
        const question = interaction.options.getString('question');
        await interaction.deferReply();

        try {
            const serverContext = buildServerContext(interaction);
            const aiReply = await generateAIResponse(question, interaction.channelId, serverContext);

            addMessageToHistory(interaction.channelId, 'user', question, interaction.user.username);
            addMessageToHistory(interaction.channelId, 'model', aiReply, 'null');

            const chunks = splitDiscordMessage(aiReply);
            await interaction.editReply({ content: chunks[0] });
            for (let i = 1; i < chunks.length; i++) {
                await interaction.channel.send({ content: chunks[i] });
            }
        } catch (err) {
            await interaction.editReply({ content: `⚠️ AI error: ${err.message}` });
        }
    }

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

            const resolve = await client.riffy.resolve({
                query: query,
                requester: interaction.user
            });

            if (!resolve || !resolve.tracks || !resolve.tracks.length) {
                return interaction.editReply({ content: `❌ No results found for: \`${query}\`` });
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
                const track = resolve.tracks[0];
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

        const activeAiList = [];
        if (process.env.GROQ_API_KEY) activeAiList.push('Groq (14.4k/day)');
        if (process.env.OPENROUTER_API_KEY) activeAiList.push('OpenRouter');
        if (process.env.GEMINI_API_KEY) activeAiList.push('Gemini (1.5k/day)');

        const aiStatus = activeAiList.length > 0
            ? `🟢 Active (${activeAiList.join(' ↔ ')} Auto-Rotation & Cascade)`
            : '🟡 Waiting for Key (Add GROQ_API_KEY in .env)';

        const embed = new EmbedBuilder()
            .setTitle('⚙️ null — System, Music & AI Brain Status')
            .setColor(0x5865F2)
            .setThumbnail(client.user.displayAvatarURL())
            .addFields(
                { name: '🤖 Bot Status', value: 'ONLINE 24/7', inline: true },
                { name: '⏱️ Uptime', value: `${hours}h ${minutes}m ${seconds}s`, inline: true },
                { name: '📶 Discord Ping', value: `${client.ws.ping}ms`, inline: true },
                { name: '🧠 AI Brain', value: `${aiStatus}\n*Mention @null or reply to messages to talk!*`, inline: false },
                { name: '💾 Total RAM Usage', value: `**${rssMB} MB** (Heap: ${heapMB} MB)\n*Ultra-low memory profile (<40MB)*`, inline: false },
                { name: '🎧 Audio Cluster', value: `Lavalink v4 Cluster\n${connectedNodes}`, inline: false },
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
            .setDescription('Ultra-lightweight, 24/7 high-fidelity music bot with interactive buttons and an AI brain.')
            .setColor(0x5865F2)
            .addFields(
                { name: '🧠 AI Chat & Web Search', value: '• **Mention `@null`** in any channel to chat!\n• **Reply to null\'s messages** to continue the conversation!\n• `/ask <question>` — Ask the AI with live Google Search!\n• Remembers **50 messages** of history and knows server members & roles!' },
                { name: '🎶 Music Playback', value: '`/play <song>` — Play songs or playlists (YouTube, Spotify, SoundCloud)\n`/pause` — Pause music\n`/resume` — Resume music\n`/skip` — Skip to next song\n`/stop` — Stop playback & disconnect' },
                { name: '📜 Queue & Audio', value: '`/nowplaying` — Live song display with progress bar & buttons\n`/queue` — Show upcoming songs\n`/shuffle` — Shuffle the queue\n`/volume <1-100>` — Change playback volume' },
                { name: '⚙️ Utilities', value: '`/null` — Bot status, memory diagnostics & AI brain info\n`/ping` — Check latency\n`/help` — Display this guide' }
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
