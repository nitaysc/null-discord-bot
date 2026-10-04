require('dotenv').config();
const v8 = require('v8');
const vm = require('vm');
const os = require('os');
const fs = require('fs');
const path = require('path');

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
    SlashCommandBuilder,
    AttachmentBuilder
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

    // Server roles summary (compact)
    const serverRoles = guild.roles.cache
        .filter(r => r.name !== '@everyone')
        .map(r => r.name)
        .slice(0, 15)
        .join(', ');

    // Mentioned users info
    let mentionedUsers = '';
    if (message.mentions.members && message.mentions.members.size > 0) {
        const list = message.mentions.members
            .filter(m => m.id !== client.user.id)
            .map(m => {
                const r = m.roles.cache.filter(role => role.name !== '@everyone').map(role => role.name).join(', ') || 'None';
                return `- User: ${m.user.username} (Nickname: ${m.displayName}, ID: ${m.id}), Roles: [${r}]`;
            });
        if (list.length > 0) {
            mentionedUsers = `\nMentioned Users in Message:\n${list.join('\n')}`;
        }
    }

    // Cached members sample (compact)
    const membersSample = guild.members.cache
        .filter(m => !m.user.bot)
        .map(m => {
            const r = m.roles.cache.filter(role => role.name !== '@everyone').map(role => role.name).join(', ') || 'None';
            return `${m.displayName} (@${m.user.username}, Roles: [${r}])`;
        })
        .slice(0, 12)
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

// Response cleaner: completely removes internal thinking, <think> tags, and CoT monologue
function cleanAIResponse(text) {
    if (!text) return '';
    let cleaned = text;

    // Remove XML thinking and reasoning tags
    cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, '');
    cleaned = cleaned.replace(/<thought>[\s\S]*?<\/thought>/gi, '');
    cleaned = cleaned.replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '');

    // Strip monologue patterns where the model repeats the prompt and reasons about it
    if (/^(User:\s*".*?"|The user (asks|wants|is asking|requested)|Let's (see|analyze|think)|Thinking Process:|Reasoning:)/i.test(cleaned.trim())) {
        const parts = cleaned.split(/\n\s*\n+/);
        for (let i = parts.length - 1; i >= 0; i--) {
            const p = parts[i].trim();
            if (!/^(User:\s*"|The user |They want |Let's |First,|Perhaps |We need to |Probably |In conclusion)/i.test(p) && p.length > 5) {
                cleaned = parts.slice(i).join('\n\n');
                break;
            }
        }
    }

    return cleaned.trim();
}

// Smart Multilingual Search Intent Classifier:
// Detects when the user actually needs live real-time web facts (teams, seasons, scores, news, prices, weather)
// Avoids searching on casual chat, greetings, repeat requests, jokes, or creative prompts
function shouldSearchWeb(prompt) {
    const text = prompt.trim();

    // 1. Never search on casual conversational greetings or short small talk
    if (/^(היי|שלום|מה קורה|מה נשמע|מה שלומך|הי|בוקר טוב|ערב טוב|לילה טוב|תודה|סבבה|אחלה|חחח|hi|hello|hey|how are you|what's up|sup|thanks|ok|cool|bye|good morning|yo)\b/i.test(text) && text.length < 35) {
        return false;
    }
    // 2. Never search on bot identity questions
    if (/^(מי אתה|מה אתה|מה אתה יכול לעשות|who are you|what can you do|what are you)\b/i.test(text)) {
        return false;
    }
    // 3. Never search on creative, repetition, code, or joke prompts unless containing real-time keywords
    if (/^(תכתוב|תספר|תרגם|תמציא|תסביר|תקודד|כתוב|ספר|תעשה|write|tell me a joke|repeat|say|translate|code|explain)\b/i.test(text) && !/(היום|עכשיו|כרגע|העונה|חדשות|today|current|latest|news)/i.test(text)) {
        return false;
    }

    // 4. Explicit search commands
    if (/(חפש|תחפש|תגגל|גוגל|תבדוק ברשת|תבדוק באינטרנט|search|google|look up|check online)/i.test(text)) {
        return true;
    }

    // 5. Hebrew real-time indicators (current team, season, scores, today, now, latest, weather, standings)
    const hebrewRealTime = /(היום|עכשיו|כרגע|השנה|העונה|האחרון|האחרונה|הכי חדש|הכי עדכני|חדשות|תוצאה|תוצאות|מזג אוויר|מזג האוויר|באיזה קבוצה|איפה.*משחק|מתי יוצא|מי ניצח|כמה עולה)/i.test(text);

    // 6. English real-time indicators
    const englishRealTime = /\b(today|tonight|right now|currently|current|latest|recent|newest|this season|what season|which team|score|standings|roster|weather|who won|price of)\b/i.test(text);

    return hebrewRealTime || englishRealTime;
}

// Intelligent Search Query Extractor: Cleans conversational filler words
function extractSearchQuery(prompt) {
    let clean = prompt.replace(/<@!?\d+>/g, '').trim();
    clean = clean.replace(/^(can you |could you |please |hey |null,?\s*|bot,?\s*|תגיד לי |תבדוק |תחפש |חפש |תגגל )*/i, '');
    clean = clean.replace(/^(search( the web)?( for)?|look up|google|find( out)?( about)?|tell me( about)?|what is|who is)\s+/i, '');
    return clean.replace(/[?!.]+$/, '').trim() || prompt.trim();
}

// Multi-Source Live Web Search (DuckDuckGo HTML + Google News RSS + Wikipedia)
async function searchWeb(query) {
    const results = [];
    const sources = [];
    const isHebrew = /[\u0590-\u05FF]/.test(query);

    // 1. DuckDuckGo Web Snippets (Fast real-time web results)
    try {
        const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
        const ddgRes = await fetch(ddgUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
            signal: AbortSignal.timeout(3500)
        });
        if (ddgRes.ok) {
            const html = await ddgRes.text();
            const matches = [...html.matchAll(/<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)].slice(0, 3);
            for (const m of matches) {
                const snippet = m[1].replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").trim();
                if (snippet) results.push(`- [Web Fact]: ${snippet}`);
            }
            if (matches.length > 0) sources.push('חיפוש רשת');
        }
    } catch {}

    // 2. Google News & Live Real-Time RSS (Localized IL/US for scores, latest events, 2026 data)
    try {
        const hl = isHebrew ? 'he' : 'en-US';
        const gl = isHebrew ? 'IL' : 'US';
        const ceid = isHebrew ? 'IL:he' : 'US:en';
        const newsUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=${hl}&gl=${gl}&ceid=${ceid}`;
        const newsRes = await fetch(newsUrl, { signal: AbortSignal.timeout(3500) });
        if (newsRes.ok) {
            const xml = await newsRes.text();
            const items = [...xml.matchAll(/<title>([^<]+)<\/title>[\s\S]*?<source[^>]*>([^<]+)<\/source>/g)].slice(0, 3);
            if (items.length > 0) {
                for (const item of items) {
                    results.push(`- [Live News / Fact]: ${item[1]}`);
                    if (item[2] && !sources.includes(item[2])) sources.push(item[2]);
                }
            } else {
                const simpleTitles = [...xml.matchAll(/<title>([^<]+)<\/title>/g)].slice(1, 4);
                for (const t of simpleTitles) {
                    results.push(`- [Live News]: ${t[1]}`);
                }
                if (simpleTitles.length > 0) sources.push('חדשות Google');
            }
        }
    } catch {}

    // 3. Wikipedia Entity Search & Extract
    try {
        const wikiLang = isHebrew ? 'he' : 'en';
        const wikiSearchUrl = `https://${wikiLang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&utf8=`;
        const sRes = await fetch(wikiSearchUrl, { signal: AbortSignal.timeout(3000) });
        if (sRes.ok) {
            const sData = await sRes.json();
            const topTitle = sData.query?.search?.[0]?.title;
            if (topTitle) {
                const sumRes = await fetch(`https://${wikiLang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(topTitle)}`, { signal: AbortSignal.timeout(2500) });
                if (sumRes.ok) {
                    const sumData = await sumRes.json();
                    if (sumData.extract) {
                        results.push(`- [Wikipedia Summary - ${topTitle}]: ${sumData.extract}`);
                        sources.push(`ויקיפדיה (${topTitle})`);
                    }
                }
            }
        }
    } catch {}

    return {
        text: results.slice(0, 5).join('\n'),
        sources: [...new Set(sources)]
    };
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

// 1. Groq Cloud Engine (14,400 req/day - GPT-OSS 120B Flagship Intelligence)
async function callGroq(groqKey, systemInstructionText, history, prompt) {
    const models = [
        'openai/gpt-oss-120b',
        'openai/gpt-oss-20b',
        'qwen/qwen3.8-27b',
        'allam-2-7b'
    ];

    // Compact history to prevent exceeding Groq TPM token limits
    const promptHistory = (history || []).slice(-12).map(h => ({
        role: h.role === 'model' ? 'assistant' : 'user',
        content: String(h.text || '').slice(0, 500)
    }));

    const messages = [
        { role: 'system', content: systemInstructionText },
        ...promptHistory,
        { role: 'user', content: String(prompt).slice(0, 1000) }
    ];

    let lastErr = null;
    let anyRateLimited = false;

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
                    max_tokens: 1000,
                    temperature: 0.5
                }),
                signal: AbortSignal.timeout(15000)
            });

            const data = await res.json().catch(() => ({}));

            if (res.ok) {
                const choice = data.choices?.[0]?.message;
                // NEVER return choice.reasoning! Only take content, and strip thoughts!
                let text = choice?.content?.trim();
                if (text) {
                    text = cleanAIResponse(text);
                    if (text.length > 0) {
                        return text;
                    }
                }
            }

            const errMsg = data.error?.message || `Status ${res.status}`;
            if (res.status === 429 || data.error?.code === 'rate_limit_exceeded') {
                anyRateLimited = true;
                console.warn(`[Groq] Model "${model}" hit per-minute limit (${errMsg}). Cascading to next model...`);
            } else {
                console.warn(`[Groq] Model "${model}" notice (${errMsg}). Cascading to next model...`);
            }
            lastErr = new Error(errMsg);
        } catch (e) {
            console.warn(`[Groq] Model "${model}" request error: ${e.message}. Cascading to next model...`);
            lastErr = e;
        }
    }

    const errToThrow = lastErr || new Error('All Groq models failed');
    if (anyRateLimited) {
        errToThrow.isRateLimit = true;
        errToThrow.status = 429;
    }
    throw errToThrow;
}

// 2. OpenRouter Engine (Multi-model free tier with 429 detection)
async function callOpenRouter(openrouterKey, systemInstructionText, history, prompt) {
    const promptHistory = (history || []).slice(-12).map(h => ({
        role: h.role === 'model' ? 'assistant' : 'user',
        content: String(h.text || '').slice(0, 500)
    }));

    const messages = [
        { role: 'system', content: systemInstructionText },
        ...promptHistory,
        { role: 'user', content: String(prompt).slice(0, 1000) }
    ];

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
            max_tokens: 500
        }),
        signal: AbortSignal.timeout(15000)
    });

    const data = await res.json().catch(() => ({}));

    if (res.status === 429) {
        const err = new Error(data.error?.message || 'OpenRouter daily free-tier limit reached (50 requests/day)');
        err.status = 429;
        err.isRateLimit = true;
        throw err;
    }

    if (!res.ok) {
        const err = new Error(data.error?.message || `OpenRouter error (${res.status})`);
        if (data.error?.code === 429 || err.message.toLowerCase().includes('rate limit')) {
            err.status = 429;
            err.isRateLimit = true;
        }
        throw err;
    }

    const reply = data.choices?.[0]?.message?.content;
    if (reply && reply.trim().length > 0) return reply.trim();
    throw new Error('OpenRouter returned empty choices');
}

// ==========================================
// 📸 MULTIMODAL GEMINI VISION ENGINE
// (Images, GIFs, Attachments & Visual Replies)
// ==========================================

// Extract all direct images, GIF embeds, and media attachments from a Discord message
function extractImagesFromMessage(msg) {
    if (!msg) return [];
    const images = [];

    // 1. Direct Discord message attachments (png, jpg, gif, webp, etc.)
    if (msg.attachments && msg.attachments.size > 0) {
        for (const [_, att] of msg.attachments) {
            const isImg = att.contentType?.startsWith('image/') ||
                /\.(png|jpe?g|gif|webp|bmp|tiff)$/i.test(att.name || att.url);
            if (isImg && att.url) {
                images.push(att.url);
            }
        }
    }

    // 2. Embeds (Tenor GIFs, Giphy, direct image embeds)
    if (msg.embeds && msg.embeds.length > 0) {
        for (const emb of msg.embeds) {
            const imgUrl = emb.image?.url || emb.thumbnail?.url;
            if (imgUrl && !images.includes(imgUrl)) {
                images.push(imgUrl);
            }
        }
    }

    // 3. URLs in message content
    if (msg.content) {
        const urlRegex = /(https?:\/\/[^\s<>]+\.(?:png|jpe?g|gif|webp)(?:\?[^\s<>]*)?)/gi;
        let match;
        while ((match = urlRegex.exec(msg.content)) !== null) {
            if (!images.includes(match[1])) {
                images.push(match[1]);
            }
        }
    }

    return images;
}

// Download image or GIF and convert to base64 inlineData for Gemini Vision
async function fetchImagePart(url) {
    try {
        const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
        if (!res.ok) return null;

        const contentLength = res.headers.get('content-length');
        if (contentLength && parseInt(contentLength, 10) > 8 * 1024 * 1024) {
            console.warn(`[Gemini Vision] Image skipped (exceeds 8MB limit): ${url}`);
            return null;
        }

        let mimeType = res.headers.get('content-type')?.split(';')[0]?.trim()?.toLowerCase() || 'image/jpeg';
        if (!mimeType.startsWith('image/')) {
            if (/\.png(\?|$)/i.test(url)) mimeType = 'image/png';
            else if (/\.gif(\?|$)/i.test(url)) mimeType = 'image/gif';
            else if (/\.webp(\?|$)/i.test(url)) mimeType = 'image/webp';
            else mimeType = 'image/jpeg';
        }

        const arrayBuffer = await res.arrayBuffer();
        const base64Data = Buffer.from(arrayBuffer).toString('base64');
        return {
            inlineData: {
                mimeType: mimeType,
                data: base64Data
            }
        };
    } catch (e) {
        console.warn(`[Gemini Vision] Failed to download image ${url}:`, e.message);
        return null;
    }
}

let cachedGeminiVisionModels = null;
let lastModelCheck = 0;

// Dynamic model discovery: Queries Google's ModelService to list active models supporting generateContent
async function getAvailableGeminiVisionModels(geminiKey) {
    if (cachedGeminiVisionModels && Date.now() - lastModelCheck < 60 * 60 * 1000) {
        return cachedGeminiVisionModels;
    }

    const fallbackList = ['gemini-3.8-flash', 'gemini-2.5-flash', 'gemini-flash'];

    try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${geminiKey}`, {
            signal: AbortSignal.timeout(8000)
        });
        if (res.ok) {
            const data = await res.json();
            const supported = (data.models || [])
                .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
                .map(m => m.name.replace(/^models\//, ''));

            const flashModels = supported.filter(m => /flash/i.test(m));
            const otherModels = supported.filter(m => !/flash/i.test(m) && /gemini/i.test(m));
            const ordered = [...flashModels, ...otherModels];

            if (ordered.length > 0) {
                cachedGeminiVisionModels = ordered;
                lastModelCheck = Date.now();
                return cachedGeminiVisionModels;
            }
        }
    } catch (e) {
        console.warn('[Gemini Vision] Could not fetch dynamic models list:', e.message);
    }

    return fallbackList;
}

// 3. Google Gemini Vision Engine (Multimodal for Images, GIFs, Screenshots & Memes)
async function callGeminiVision(geminiKey, systemInstructionText, history, prompt, imageUrls) {
    const contents = [];
    const promptHistory = (history || []).slice(-6);
    for (const h of promptHistory) {
        contents.push({
            role: h.role === 'model' ? 'model' : 'user',
            parts: [{ text: h.role === 'user' ? `[${h.name}]: ${String(h.text || '').slice(0, 500)}` : String(h.text || '').slice(0, 500) }]
        });
    }

    // Download up to 3 images/GIFs concurrently
    const imageParts = [];
    for (const imgUrl of imageUrls.slice(0, 3)) {
        const part = await fetchImagePart(imgUrl);
        if (part) imageParts.push(part);
    }

    if (imageParts.length === 0) {
        throw new Error('לא הצלחתי להוריד את התמונה/גיף לצורך ניתוח.');
    }

    const userParts = [
        ...imageParts,
        { text: String(prompt).slice(0, 1500) }
    ];

    contents.push({
        role: 'user',
        parts: userParts
    });

    const dynamicModels = await getAvailableGeminiVisionModels(geminiKey);
    // Explicitly place gemini-3.8-flash first as instructed by Google API, followed by dynamic models
    const visionModels = [...new Set(['gemini-3.8-flash', ...dynamicModels, 'gemini-2.5-flash', 'gemini-flash'])];
    let lastErr = null;

    for (const model of visionModels) {
        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;
            const payload = {
                systemInstruction: { parts: [{ text: systemInstructionText }] },
                contents: contents,
                generationConfig: {
                    temperature: 0.7,
                    maxOutputTokens: 1000
                }
            };

            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: AbortSignal.timeout(25000)
            });

            if (response.status === 429) {
                const err = new Error('Gemini Vision 429 rate limit exceeded');
                err.status = 429;
                err.isRateLimit = true;
                throw err;
            }

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                const err = new Error(errData.error?.message || `Gemini Vision error (${response.status})`);
                if (response.status === 429 || err.message.toLowerCase().includes('quota') || err.message.toLowerCase().includes('rate')) {
                    err.status = 429;
                    err.isRateLimit = true;
                }
                throw err;
            }

            const data = await response.json();
            let replyText = data.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
            replyText = cleanAIResponse(replyText);
            if (replyText && replyText.trim().length > 0) return replyText.trim();
        } catch (e) {
            console.warn(`[Gemini Vision] Model ${model} notice: ${e.message}. Cascading...`);
            lastErr = e;
        }
    }

    throw lastErr || new Error('Gemini Vision returned empty candidate.');
}

// Main AI Handler: Routes Images & GIFs to Gemini Vision, and all Text to Groq (with OpenRouter fallback)
async function generateAIResponse(prompt, channelId, serverContext, imageUrls = []) {
    const groqKey = process.env.GROQ_API_KEY?.trim();
    const geminiKey = process.env.GEMINI_API_KEY?.trim();
    const openrouterKey = process.env.OPENROUTER_API_KEY?.trim();

    // ==========================================
    // 📸 VISION PIPELINE: Images, GIFs & Replies (Exclusively Gemini)
    // ==========================================
    if (imageUrls && imageUrls.length > 0) {
        if (!geminiKey) {
            return `📸 **זיהיתי ששלחת תמונה או גיף!**
כדי שאוכל לראות, לפענח ולהגיב על תמונות, ממים וגיפים, יש צורך במפתח חינמי של **Google Gemini Vision**:

1️⃣ פתח מפתח בחינם תוך שניות בקישור: **https://aistudio.google.com/app/apikey**
2️⃣ בלוח הניהול של **bot-hosting.net** הוסף לקובץ \`.env\` שלך:
\`GEMINI_API_KEY=המפתח_שלך_מגוגל\`
3️⃣ לחץ שמירה ועשה **Restart** לבוט!

*(שיחות טקסט רגילות ממשיכות לעבוד כרגיל דרך Groq!)*`;
        }

        const history = conversationHistories.get(channelId) || [];
        const systemInstructionText = `You are "null", a brilliant, sharp-witted, highly observant, and helpful AI companion living inside a Discord server.
${serverContext}
Core Multimodal Vision Capabilities:
- You have exceptional visual intelligence. Carefully examine images, screenshots, memes, diagrams, coding errors, art, and GIFs provided to you.
- Respond fluently in the language the user addresses you in (Hebrew, English, etc.).
- If analyzing a meme, chat screenshot, or GIF, explain the humor, reference, and context with wit, charm, and friendly Discord vibes.
- If analyzing code or an error screenshot, identify the exact issue and provide the solution.
- Maintain a consistent, grounded personality. Do not hallucinate false facts or fabricate details not shown in the image.
- CRITICAL: NEVER output internal monologue, thinking process (<think>), or start with "User: ...". Reply directly and naturally as null.`;

        try {
            const visionReply = await callGeminiVision(geminiKey, systemInstructionText, history, prompt, imageUrls);
            if (visionReply && visionReply.length > 0) {
                return visionReply;
            }
        } catch (err) {
            console.error('Gemini Vision error:', err.message);
            if (err.isRateLimit || err.status === 429) {
                return `⏳ **Gemini Vision הגיע למגבלת קצב רגעית (Rate Limit).** אנא נסה שוב בעוד דקה!`;
            }
            return `⚠️ **הייתה שגיאה בעיבוד התמונה עם Gemini Vision:** \`${err.message}\``;
        }
    }

    // ==========================================
    // 💬 TEXT PIPELINE: Exclusively Groq (with OpenRouter fallback)
    // ==========================================
    if (!groqKey && !openrouterKey) {
        return `👋 **Hey! My AI brain is ready, but I need an AI token to activate my thoughts!**

🔑 **How to add your API key**:
In your **bot-hosting.net** panel:
- Open \`.env\` in **File Manager** (or Environment Variables)
- Add: \`GROQ_API_KEY=your_key_here\`
- Click **Save** and **Restart**!`;
    }

    const history = conversationHistories.get(channelId) || [];

    // Real-Time Web Search Trigger & Extraction (Smart Multilingual Classifier)
    let liveWebContext = '';
    let searchSources = [];
    let executedSearchQuery = null;

    if (shouldSearchWeb(prompt)) {
        executedSearchQuery = extractSearchQuery(prompt);
        if (executedSearchQuery) {
            const searchRes = await searchWeb(executedSearchQuery);
            if (searchRes && searchRes.text) {
                liveWebContext = `\nREAL-TIME LIVE WEB SEARCH RESULTS for "${executedSearchQuery}":\n${searchRes.text}\n(Use these verified real-time facts to answer accurately. If asked about current teams, seasons, scores, or news, rely on these facts!)\n`;
                searchSources = searchRes.sources || [];
            }
        }
    }

    const systemInstructionText = `You are "null", a brilliant, sharp-witted, highly intelligent, and helpful AI companion living inside a Discord server.
${serverContext}
${liveWebContext}
Core Personality & Capabilities:
- You are knowledgeable, perceptive, and quick-witted with a cool, natural Discord vibe.
- You speak fluently in the language the user speaks to you (Hebrew, English, etc.). Answer with high intelligence, depth, and great clarity.
- When answering complex, factual, or programming questions, provide high-quality, comprehensive answers with clean markdown.
- CRITICAL: Never show internal reasoning, thinking process (<think>), or monologue. Directly output your final, polished response. Never start with "User: ...", "They want ...", or "The user asks ...".
- ANTI-HALLUCINATION & INTEGRITY GUARDRAILS:
  * NEVER invent, hallucinate, or fabricate non-existent words, fake facts, fake quotes, or fake rules. If a word or fact does not exist in standard dictionaries or reality, say so honestly.
  * In word games (Hangman, Wordle, 20 Questions, Trivia): You MUST choose an actual, common, real dictionary word at the very start and stick to it strictly. NEVER change the word mid-game, NEVER make up non-existent words (like 'gahog' or 'gahag'), and NEVER gaslight users about what they guessed or whether a letter is in the word. If a user guessed right, acknowledge it immediately.
- When live web search results are provided above, use them directly to provide accurate, up-to-date facts (current teams, latest seasons, scores, news).
- You remember recent conversation in this channel and understand who is speaking to you.
- Maintain a consistent, grounded personality. Do not pretend to have multiple split personalities.
- Do not mention that you are an AI model or prompt; just talk naturally as null.`;

    // Only Groq and OpenRouter for text! Gemini is reserved exclusively for images & GIFs.
    const textProviders = [];
    if (groqKey) textProviders.push('groq');
    if (openrouterKey) textProviders.push('openrouter');

    const now = Date.now();
    const healthyProviders = textProviders.filter(p => !aiCooldowns[p] || aiCooldowns[p] <= now);
    const candidateList = healthyProviders.length > 0 ? healthyProviders : [...textProviders];

    // Priority: Groq first (14.4k/day, fast), OpenRouter fallback
    const executionOrder = [];
    if (candidateList.includes('groq')) executionOrder.push('groq');
    if (candidateList.includes('openrouter')) executionOrder.push('openrouter');

    // Append any providers on cooldown
    for (const p of textProviders) {
        if (!executionOrder.includes(p)) executionOrder.push(p);
    }

    const providerErrors = {};

    for (const provider of executionOrder) {
        try {
            let reply = null;
            if (provider === 'groq') {
                reply = await callGroq(groqKey, systemInstructionText, history, prompt);
            } else if (provider === 'openrouter') {
                reply = await callOpenRouter(openrouterKey, systemInstructionText, history, prompt);
            }

            if (reply && reply.trim().length > 0) {
                aiCooldowns[provider] = 0; // Success: clear cooldown
                if (executedSearchQuery && liveWebContext && !reply.includes('מקורות מידע:') && !reply.includes('Searched the web')) {
                    const sourcesText = searchSources.length > 0
                        ? searchSources.map(s => `\`${s}\``).join(' • ')
                        : `חיפוש רשת: "${executedSearchQuery}"`;
                    reply += `\n\n🌐 *מקורות מידע:* ${sourcesText}`;
                }
                return reply;
            }
        } catch (err) {
            providerErrors[provider] = err.message;
            if (err.isRateLimit || err.status === 429) {
                const cooldownMs = (provider === 'groq') ? 10 * 1000 : 30 * 60 * 1000;
                aiCooldowns[provider] = Date.now() + cooldownMs;
                console.warn(`⚠️ [AI Fallback] Provider "${provider}" rate limited (${err.message}). Cascading to next provider...`);
            } else {
                aiCooldowns[provider] = Date.now() + (10 * 1000);
                console.warn(`⚠️ [AI Fallback] Provider "${provider}" error (${err.message}). Cascading to next provider...`);
            }
        }
    }

    const errorLines = Object.entries(providerErrors).map(([p, e]) => `• **${p}**: ${e}`).join('\n');
    return `⚠️ **I couldn't get a response from my AI text providers right now:**\n${errorLines}\n*Please wait a few moments and try again.*`;
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

// ==========================================
// 🏆 ARCADE-STYLE LEVELING & RANK SYSTEM
// (Texts Sent, Minutes in Call, Level & XP)
// ==========================================

let canvasModule = null;
try {
    canvasModule = require('@napi-rs/canvas');
} catch (e) {
    console.warn('[Canvas Notice] @napi-rs/canvas not available, will use embed fallback:', e.message);
}

// ==========================================
// 🎨 CARD THEMES & PALETTES SHOP
// ==========================================
const CARD_THEMES = {
    arcane: {
        id: 'arcane',
        name: 'Arcane Classic',
        price: 0,
        emoji: '💎',
        category: 'Classic',
        description: 'Iconic Arcane dark charcoal with vibrant turquoise polygon.',
        bg: '#202225',
        accent: '#2bb6a6',
        accentSecondary: '#1f8b7f',
        textPrimary: '#ffffff',
        textSecondary: '#b5bac1',
        barBg: '#ffffff'
    },
    cyberpunk: {
        id: 'cyberpunk',
        name: 'Cyberpunk Neon',
        price: 400,
        emoji: '⚡',
        category: 'Crazy & Cool',
        description: 'Futuristic synthwave with neon hot pink and electric cyan.',
        bg: '#140c1f',
        accent: '#ff007f',
        accentSecondary: '#00f0ff',
        textPrimary: '#ffffff',
        textSecondary: '#d8b4f8',
        barBg: '#2a1b3d'
    },
    galaxy: {
        id: 'galaxy',
        name: 'Cosmic Galaxy',
        price: 500,
        emoji: '🌌',
        category: 'Crazy & Cool',
        description: 'Deep starlight abyss with royal amethyst purple and gold.',
        bg: '#0d1117',
        accent: '#8a2be2',
        accentSecondary: '#ffd700',
        textPrimary: '#ffffff',
        textSecondary: '#c9d1d9',
        barBg: '#1e1e2f'
    },
    crimson: {
        id: 'crimson',
        name: 'Bloodmoon Crimson',
        price: 450,
        emoji: '🩸',
        category: 'Crazy & Cool',
        description: 'Obsidian black with blazing ruby red and wine accents.',
        bg: '#181112',
        accent: '#ff2a4b',
        accentSecondary: '#99001a',
        textPrimary: '#ffffff',
        textSecondary: '#d4afb3',
        barBg: '#2c181a'
    },
    nature: {
        id: 'nature',
        name: 'Forest Emerald',
        price: 350,
        emoji: '🌿',
        category: 'Natural',
        description: 'Serene dark pine moss with lush emerald green and jade.',
        bg: '#121a15',
        accent: '#2ecc71',
        accentSecondary: '#27ae60',
        textPrimary: '#ffffff',
        textSecondary: '#a3cfbb',
        barBg: '#1e2d24'
    },
    sunset: {
        id: 'sunset',
        name: 'Golden Sunset',
        price: 350,
        emoji: '🌅',
        category: 'Natural',
        description: 'Warm espresso dusk with radiant sunset coral and amber.',
        bg: '#1c1514',
        accent: '#ff7e47',
        accentSecondary: '#f39c12',
        textPrimary: '#ffffff',
        textSecondary: '#dfb8aa',
        barBg: '#2f201d'
    },
    ocean: {
        id: 'ocean',
        name: 'Abyssal Ocean',
        price: 400,
        emoji: '🌊',
        category: 'Natural',
        description: 'Deep ocean abyss with Caribbean lagoon aqua and seafoam.',
        bg: '#0e1a24',
        accent: '#00c0f0',
        accentSecondary: '#0077b6',
        textPrimary: '#ffffff',
        textSecondary: '#9ec5e4',
        barBg: '#162b3c'
    }
};

const LEVELS_FILE = path.resolve(__dirname, 'levels.json');
let levelsCache = {};
let levelsDirty = false;

// Safe synchronous load of levels database
function loadLevels() {
    try {
        if (fs.existsSync(LEVELS_FILE)) {
            const raw = fs.readFileSync(LEVELS_FILE, 'utf8');
            levelsCache = JSON.parse(raw);
        }
    } catch (e) {
        console.warn('[Leveling] Could not load levels.json, starting fresh:', e.message);
        levelsCache = {};
    }
}

// Atomic synchronous save: writes to .tmp then renames to prevent file corruption
function saveLevels() {
    try {
        const tmpFile = `${LEVELS_FILE}.tmp`;
        fs.writeFileSync(tmpFile, JSON.stringify(levelsCache, null, 2), 'utf8');
        fs.renameSync(tmpFile, LEVELS_FILE);
        levelsDirty = false;
    } catch (e) {
        console.error('[Leveling] Failed to save levels.json:', e.message);
    }
}

// Initial load
loadLevels();

// Periodic auto-save safety net
setInterval(() => {
    if (levelsDirty) saveLevels();
}, 5000).unref();

// Process exit safeguards to ensure 100% data preservation across restarts
process.on('exit', saveLevels);
process.on('beforeExit', saveLevels);
process.on('SIGINT', () => { saveLevels(); process.exit(); });
process.on('SIGTERM', () => { saveLevels(); process.exit(); });

// Helper to get or initialize a user's record
function getOrCreateUser(guildId, userId, username = 'Unknown') {
    const key = `${guildId}_${userId}`;
    if (!levelsCache[key]) {
        levelsCache[key] = {
            userId: userId,
            guildId: guildId,
            xp: 0,
            messages: 0,
            voiceMinutes: 0,
            points: 100, // 100 free starting points
            inventory: ['arcane'],
            equippedTheme: 'arcane',
            lastTextXp: 0,
            lastDaily: 0,
            username: username
        };
        saveLevels();
    } else {
        // Upgrade existing records if fields are missing
        if (levelsCache[key].points === undefined) levelsCache[key].points = 0;
        if (!levelsCache[key].inventory) levelsCache[key].inventory = ['arcane'];
        if (!levelsCache[key].equippedTheme) levelsCache[key].equippedTheme = 'arcane';
        if (username && username !== 'Unknown' && levelsCache[key].username !== username) {
            levelsCache[key].username = username;
            levelsDirty = true;
        }
    }
    return levelsCache[key];
}

// Arcade / Arcane leveling formula:
// XP needed to advance from level L to L+1: 5 * L^2 + 50 * L + 100
function getXpForNextLevel(level) {
    return 5 * (level * level) + (50 * level) + 100;
}

// Returns { level, currentXp, neededXp, percent }
function calculateLevelData(totalXp) {
    let xp = Math.max(0, totalXp || 0);
    let level = 0;
    while (true) {
        const needed = getXpForNextLevel(level);
        if (xp < needed) {
            return {
                level,
                currentXp: xp,
                neededXp: needed,
                percent: Math.min(Math.round((xp / needed) * 100), 100)
            };
        }
        xp -= needed;
        level++;
    }
}

// Calculates rank (#1, #2, etc.) for a user within a specific guild
function getUserRank(guildId, targetUserId, sortBy = 'xp') {
    const guildEntries = Object.values(levelsCache)
        .filter(entry => entry.guildId === guildId && ((entry.xp || 0) > 0 || (entry.messages || 0) > 0 || (entry.voiceMinutes || 0) > 0 || (entry.points || 0) > 0))
        .sort((a, b) => sortBy === 'points' ? ((b.points || 0) - (a.points || 0)) : ((b.xp || 0) - (a.xp || 0)));

    const totalRanked = Math.max(guildEntries.length, 1);
    const index = guildEntries.findIndex(e => e.userId === targetUserId);
    const rank = index !== -1 ? index + 1 : totalRanked;
    return { rank, totalRanked };
}

// Returns top ranked users in the guild by XP or points
function getGuildLeaderboard(guildId, limit = 10, sortBy = 'xp') {
    return Object.values(levelsCache)
        .filter(entry => entry.guildId === guildId && ((entry.xp || 0) > 0 || (entry.messages || 0) > 0 || (entry.voiceMinutes || 0) > 0 || (entry.points || 0) > 0))
        .sort((a, b) => sortBy === 'points' ? ((b.points || 0) - (a.points || 0)) : ((b.xp || 0) - (a.xp || 0)))
        .slice(0, limit);
}

// Human readable voice call minutes formatting: "3h 45m"
function formatVoiceDuration(minutes) {
    if (!minutes || minutes <= 0) return '0 min';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h > 0) {
        return `${h}h ${m}m (${minutes.toLocaleString()} mins)`;
    }
    return `${m} mins`;
}

function formatK(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toLocaleString();
}

function roundRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
}

// Awards text message XP & points & increments message counter with instant persistent saving
function trackMessageForLeveling(message) {
    if (!message.guild || message.author.bot) return;

    const user = getOrCreateUser(message.guild.id, message.author.id, message.member?.displayName || message.author.username);
    user.messages = (user.messages || 0) + 1;

    const now = Date.now();
    // 60-second cooldown between message XP drops to prevent spam farming
    if (now - (user.lastTextXp || 0) >= 60000) {
        const xpGain = Math.floor(Math.random() * 11) + 15; // 15 - 25 XP
        const pointsGain = Math.floor(Math.random() * 6) + 5; // 5 - 10 Points
        const oldLevel = calculateLevelData(user.xp).level;

        user.xp = (user.xp || 0) + xpGain;
        user.points = (user.points || 0) + pointsGain;
        user.lastTextXp = now;
        saveLevels(); // Save immediately to disk

        const newLevel = calculateLevelData(user.xp).level;
        if (newLevel > oldLevel) {
            const bonusPoints = newLevel * 50; // Bonus points on level up
            user.points = (user.points || 0) + bonusPoints;
            saveLevels();

            message.channel.send({
                content: `🎉 **Level Up!** <@${message.author.id}>, you advanced to **Level ${newLevel}** and received **+${bonusPoints} Points**! ⭐🪙`
            }).catch(() => {});
        }
    } else {
        saveLevels(); // Save message count increment
    }
}

// Background Voice Call Tracker (Ticks every 60 seconds)
// Awards call minutes, voice XP and points for active members in voice channels with instant saving
setInterval(() => {
    try {
        if (!client.guilds || client.guilds.cache.size === 0) return;

        let anyChanged = false;
        for (const [guildId, guild] of client.guilds.cache) {
            for (const [channelId, channel] of guild.channels.cache) {
                if (channel.isVoiceBased() && channel.id !== guild.afkChannelId) {
                    const members = channel.members;
                    if (!members || members.size === 0) continue;

                    for (const [memberId, member] of members) {
                        if (member.user.bot) continue;

                        const isDeaf = member.voice?.deaf || member.voice?.selfDeaf;
                        if (isDeaf) continue;

                        const user = getOrCreateUser(guild.id, member.id, member.displayName || member.user.username);
                        user.voiceMinutes = (user.voiceMinutes || 0) + 1;

                        const xpGain = Math.floor(Math.random() * 6) + 10; // 10 - 15 XP per minute
                        const pointsGain = Math.floor(Math.random() * 4) + 5; // 5 - 8 Points per minute
                        const oldLevel = calculateLevelData(user.xp).level;

                        user.xp = (user.xp || 0) + xpGain;
                        user.points = (user.points || 0) + pointsGain;
                        anyChanged = true;

                        const newLevel = calculateLevelData(user.xp).level;
                        if (newLevel > oldLevel) {
                            const bonusPoints = newLevel * 50;
                            user.points = (user.points || 0) + bonusPoints;

                            if (channel.send) {
                                channel.send({
                                    content: `🎉 **Level Up!** <@${member.id}>, your time in call elevated you to **Level ${newLevel}** (+${bonusPoints} Points)! ⭐🪙`
                                }).catch(() => {});
                            }
                        }
                    }
                }
            }
        }
        if (anyChanged) saveLevels();
    } catch (e) {
        console.warn('[Leveling Voice Tick Notice]:', e.message);
    }
}, 60000).unref();

// Generates authentic Arcane-style graphical rank card image (PNG) using equipped theme
async function generateRankCardImage(member, userData) {
    if (!canvasModule) return null;
    try {
        const { createCanvas, loadImage } = canvasModule;

        const totalXp = userData.xp || 0;
        const levelData = calculateLevelData(totalXp);
        const { rank, totalRanked } = getUserRank(member.guild.id, member.id);

        const themeId = userData.equippedTheme || 'arcane';
        const theme = CARD_THEMES[themeId] || CARD_THEMES.arcane;
        const accentColor = theme.accent;

        const width = 850;
        const height = 230;
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');

        // 1. Dark Card Background (Themed)
        ctx.fillStyle = theme.bg;
        roundRect(ctx, 0, 0, width, height, 14);
        ctx.fill();

        // 2. Right-side Arcane polygon accent (Dual-tone)
        ctx.save();
        roundRect(ctx, 0, 0, width, height, 14);
        ctx.clip();

        // Secondary angle
        ctx.beginPath();
        ctx.moveTo(590, 0);
        ctx.lineTo(width, 0);
        ctx.lineTo(width, height);
        ctx.lineTo(670, height);
        ctx.closePath();
        ctx.fillStyle = theme.accentSecondary;
        ctx.fill();

        // Primary angle
        ctx.beginPath();
        ctx.moveTo(620, 0);
        ctx.lineTo(width, 0);
        ctx.lineTo(width, height);
        ctx.lineTo(705, height);
        ctx.closePath();
        ctx.fillStyle = accentColor;
        ctx.fill();

        ctx.restore();

        // Theme Badge (Top Right)
        ctx.fillStyle = theme.accent;
        ctx.font = 'bold 15px "Segoe UI", Arial, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(`${theme.emoji} ${theme.name}`, 820, 32);
        ctx.textAlign = 'left';

        // 3. User Avatar
        const avX = 85;
        const avY = 85;
        const avR = 48;

        let avatarLoaded = false;
        const avatarUrl = member.user.displayAvatarURL({ extension: 'png', size: 256 });
        if (avatarUrl) {
            try {
                const img = await loadImage(avatarUrl);
                ctx.save();
                ctx.beginPath();
                ctx.arc(avX, avY, avR, 0, Math.PI * 2);
                ctx.closePath();
                ctx.clip();
                ctx.drawImage(img, avX - avR, avY - avR, avR * 2, avR * 2);
                ctx.restore();
                avatarLoaded = true;
            } catch {}
        }

        if (!avatarLoaded) {
            ctx.save();
            ctx.beginPath();
            ctx.arc(avX, avY, avR, 0, Math.PI * 2);
            ctx.closePath();
            ctx.clip();
            ctx.fillStyle = accentColor;
            ctx.fillRect(avX - avR, avY - avR, avR * 2, avR * 2);
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 36px "Segoe UI", Arial, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(member.displayName.charAt(0).toUpperCase(), avX, avY);
            ctx.restore();
        }

        // Avatar Ring Border
        ctx.beginPath();
        ctx.arc(avX, avY, avR, 0, Math.PI * 2);
        ctx.strokeStyle = accentColor;
        ctx.lineWidth = 3.5;
        ctx.stroke();

        // 4. Username Text
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = theme.textPrimary;
        ctx.font = 'bold 30px "Segoe UI", Arial, sans-serif';
        const displayName = member.displayName || member.user.username;
        const cleanUser = displayName.startsWith('@') ? displayName : `@${displayName}`;
        ctx.fillText(cleanUser, 160, 62);

        // 5. Underline
        const textWidth = ctx.measureText(cleanUser).width;
        const underlineW = Math.max(textWidth + 20, 360);
        ctx.beginPath();
        ctx.moveTo(160, 75);
        ctx.lineTo(Math.min(160 + underlineW, 580), 75);
        ctx.strokeStyle = accentColor;
        ctx.lineWidth = 3;
        ctx.stroke();

        // 6. Stats Row 1: Level, XP, Rank
        ctx.fillStyle = theme.textPrimary;
        ctx.font = '600 20px "Segoe UI", Arial, sans-serif';
        const rankText = rank ? `   Rank: #${rank}` : '';
        ctx.fillText(`Level: ${levelData.level}   XP: ${formatK(levelData.currentXp)} / ${formatK(levelData.neededXp)}${rankText}`, 160, 112);

        // 7. Stats Row 2: Texts sent, Minutes in call, Points
        ctx.fillStyle = theme.textSecondary;
        ctx.font = '500 16px "Segoe UI", Arial, sans-serif';
        ctx.fillText(`Texts: ${(userData.messages || 0).toLocaleString()}   •   In Call: ${formatVoiceDuration(userData.voiceMinutes || 0)}   •   Points: ${(userData.points || 0).toLocaleString()} 🪙`, 160, 142);

        // 8. Progress Bar (Pill Capsule with themed background and fill)
        const barX = 30;
        const barY = 175;
        const barW = 790;
        const barH = 26;
        const barR = 13;

        // Outer capsule
        ctx.fillStyle = theme.barBg;
        roundRect(ctx, barX, barY, barW, barH, barR);
        ctx.fill();

        // Filled portion
        const ratio = Math.min(Math.max(levelData.currentXp / Math.max(levelData.neededXp, 1), 0), 1);
        const fillW = Math.max(barH, Math.round(barW * ratio));

        ctx.save();
        roundRect(ctx, barX, barY, barW, barH, barR);
        ctx.clip();

        ctx.fillStyle = accentColor;
        roundRect(ctx, barX, barY, fillW, barH, barR);
        ctx.fill();
        ctx.restore();

        return canvas.toBuffer('image/png');
    } catch (e) {
        console.error('[Canvas] Failed to generate rank card image:', e.message);
        return null;
    }
}

// Progress bar string for Embed fallback: ▰▰▰▰▰▰▱▱▱▱
function createProgressBar(current, max, size = 12) {
    const ratio = Math.min(Math.max(current / max, 0), 1);
    const filled = Math.round(size * ratio);
    const empty = size - filled;
    return '▰'.repeat(filled) + '▱'.repeat(empty);
}

// Builds the Arcade-style Rank Card Embed (Fallback if canvas is unavailable)
function createRankCardEmbed(member, userData) {
    const totalXp = userData.xp || 0;
    const levelData = calculateLevelData(totalXp);
    const { rank, totalRanked } = getUserRank(member.guild.id, member.id);

    const theme = CARD_THEMES[userData.equippedTheme] || CARD_THEMES.arcane;
    const progressBar = createProgressBar(levelData.currentXp, levelData.neededXp, 12);

    const embed = new EmbedBuilder()
        .setAuthor({
            name: `${member.displayName}'s Rank Profile (${theme.emoji} ${theme.name})`,
            iconURL: member.user.displayAvatarURL({ dynamic: true })
        })
        .setColor(0x2BB6A6)
        .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
        .addFields(
            { name: '🏆 Server Rank', value: `**#${rank}** of ${totalRanked}`, inline: true },
            { name: '⭐ Level', value: `**Level ${levelData.level}**`, inline: true },
            { name: '✨ Total XP', value: `**${totalXp.toLocaleString()} XP**`, inline: true },
            {
                name: `📈 Progress to Level ${levelData.level + 1}`,
                value: `${progressBar} **${levelData.percent}%**\n\`${levelData.currentXp.toLocaleString()} / ${levelData.neededXp.toLocaleString()} XP\` *(${(levelData.neededXp - levelData.currentXp).toLocaleString()} XP to next level)*`,
                inline: false
            },
            { name: '💬 Texts Sent', value: `**${(userData.messages || 0).toLocaleString()}** messages`, inline: true },
            { name: '🎙️ Minutes in Call', value: `**${formatVoiceDuration(userData.voiceMinutes || 0)}**`, inline: true },
            { name: '🪙 Points Balance', value: `**${(userData.points || 0).toLocaleString()}** Points`, inline: true }
        )
        .setFooter({ text: `Theme: ${theme.name} • Earn points via chatting, calls & /daily!` })
        .setTimestamp();

    return embed;
}

// Builds the Card Themes Shop Embed
function createShopEmbed(userData) {
    const balance = (userData.points || 0).toLocaleString();
    const inventory = userData.inventory || ['arcane'];
    const equipped = userData.equippedTheme || 'arcane';
    const equippedTheme = CARD_THEMES[equipped] || CARD_THEMES.arcane;

    const embed = new EmbedBuilder()
        .setTitle('🛍️ Rank Card Themes Shop')
        .setDescription(`Earn points by chatting, joining voice calls, or claiming \`/daily\`!\n💰 **Your Balance:** **${balance}** 🪙 Points\n🎨 **Currently Equipped:** **${equippedTheme.emoji} ${equippedTheme.name}**\n\n*Purchase a theme with \`/buy <theme>\` and equip it with \`/equip <theme>\`!*`)
        .setColor(0x2BB6A6);

    const categories = {
        'Crazy & Cool': [],
        'Natural': [],
        'Classic': []
    };

    for (const [id, t] of Object.entries(CARD_THEMES)) {
        const isOwned = inventory.includes(id);
        const isEquipped = equipped === id;
        let status = isEquipped ? '🟢 **[EQUIPPED]**' : (isOwned ? '✅ **[OWNED]**' : `🪙 **${t.price} Points**`);
        const itemLine = `${t.emoji} **${t.name}** (\`${t.id}\`) — ${status}\n*${t.description}*`;
        if (categories[t.category]) {
            categories[t.category].push(itemLine);
        }
    }

    embed.addFields(
        { name: '⚡ Crazy & Cool Themes', value: categories['Crazy & Cool'].join('\n\n'), inline: false },
        { name: '🌿 Natural Themes', value: categories['Natural'].join('\n\n'), inline: false },
        { name: '💎 Classic Themes', value: categories['Classic'].join('\n\n'), inline: false }
    );

    embed.setFooter({ text: 'Commands: /shop • /buy <theme> • /equip <theme> • /daily' });
    return embed;
}

// Builds the Server Leaderboard Embed (XP or Points)
function createLeaderboardEmbed(guild, requestingMember, type = 'xp') {
    const isPoints = type === 'points';
    const topUsers = getGuildLeaderboard(guild.id, 10, isPoints ? 'points' : 'xp');

    const embed = new EmbedBuilder()
        .setTitle(isPoints ? `🪙 ${guild.name} — Points Leaderboard` : `🏆 ${guild.name} — Leveling Leaderboard`)
        .setColor(0x2BB6A6)
        .setThumbnail(guild.iconURL({ dynamic: true }) || null);

    if (topUsers.length === 0) {
        embed.setDescription('No members have earned XP or points yet! Start texting, joining calls, or claim `/daily` to be #1!');
        return embed;
    }

    const medals = ['🥇', '🥈', '🥉'];
    const lines = topUsers.map((u, i) => {
        const medal = medals[i] || `\`#${i + 1}\``;
        const levelData = calculateLevelData(u.xp || 0);
        const name = u.username || `<@${u.userId}>`;
        const theme = CARD_THEMES[u.equippedTheme] || CARD_THEMES.arcane;

        if (isPoints) {
            return `${medal} **${name}** [${theme.emoji} ${theme.name}] • **${(u.points || 0).toLocaleString()} 🪙 Points** (Level ${levelData.level})`;
        } else {
            return `${medal} **${name}** [${theme.emoji}] • **Level ${levelData.level}** (${(u.xp || 0).toLocaleString()} XP) • ${(u.points || 0).toLocaleString()} 🪙\n   ↳ 💬 ${(u.messages || 0).toLocaleString()} texts • 🎙️ ${formatVoiceDuration(u.voiceMinutes || 0)}`;
        }
    });

    embed.setDescription(lines.join('\n\n'));

    if (requestingMember) {
        const userRec = getOrCreateUser(guild.id, requestingMember.id, requestingMember.displayName);
        const userLevel = calculateLevelData(userRec.xp || 0).level;
        const theme = CARD_THEMES[userRec.equippedTheme] || CARD_THEMES.arcane;
        const { rank, totalRanked } = getUserRank(guild.id, requestingMember.id, isPoints ? 'points' : 'xp');
        embed.setFooter({
            text: `Your Stats: #${rank} of ${totalRanked} • Level ${userLevel} • ${(userRec.xp || 0).toLocaleString()} XP • ${(userRec.points || 0).toLocaleString()} 🪙 • Equipped: ${theme.emoji} ${theme.name}`
        });
    }

    return embed;
}

// Handles theme purchase
function handleBuyTheme(guildId, userId, username, themeKey) {
    const user = getOrCreateUser(guildId, userId, username);
    const themeId = (themeKey || '').toLowerCase().trim();
    const theme = CARD_THEMES[themeId];

    if (!theme) {
        return { success: false, message: `❌ Theme \`${themeKey}\` not found! Use \`/shop\` to see available themes.` };
    }

    user.inventory = user.inventory || ['arcane'];
    if (user.inventory.includes(themeId)) {
        return { success: false, message: `⚠️ You already own **${theme.emoji} ${theme.name}**! Use \`/equip ${themeId}\` to equip it.` };
    }

    if ((user.points || 0) < theme.price) {
        return {
            success: false,
            message: `❌ Not enough points! **${theme.emoji} ${theme.name}** costs **${theme.price} 🪙 Points**, but you have **${(user.points || 0).toLocaleString()} 🪙 Points**.\nEarn more points by chatting, joining voice calls, or claiming \`/daily\`!`
        };
    }

    user.points -= theme.price;
    user.inventory.push(themeId);
    user.equippedTheme = themeId;
    saveLevels();

    return {
        success: true,
        message: `🎉 **Theme Purchased!** You bought and equipped **${theme.emoji} ${theme.name}** for **${theme.price} 🪙 Points**!\n💰 Remaining balance: **${user.points.toLocaleString()} 🪙 Points**\nCheck out your new look with \`/rank\`!`
    };
}

// Handles theme equipping
function handleEquipTheme(guildId, userId, username, themeKey) {
    const user = getOrCreateUser(guildId, userId, username);
    const themeId = (themeKey || '').toLowerCase().trim();
    const theme = CARD_THEMES[themeId];

    if (!theme) {
        return { success: false, message: `❌ Theme \`${themeKey}\` not found! Use \`/shop\` to see available themes.` };
    }

    user.inventory = user.inventory || ['arcane'];
    if (!user.inventory.includes(themeId)) {
        return { success: false, message: `🔒 You don't own **${theme.emoji} ${theme.name}** yet! Buy it from the \`/shop\` with \`/buy ${themeId}\`.` };
    }

    if (user.equippedTheme === themeId) {
        return { success: false, message: `ℹ️ **${theme.emoji} ${theme.name}** is already equipped!` };
    }

    user.equippedTheme = themeId;
    saveLevels();

    return {
        success: true,
        message: `🎨 **Equipped!** Your rank card is now styled with **${theme.emoji} ${theme.name}**!\nType \`/rank\` to see your card.`
    };
}

// Handles daily 200 points reward (24h cooldown)
function handleDailyReward(guildId, userId, username) {
    const user = getOrCreateUser(guildId, userId, username);
    const now = Date.now();
    const COOLDOWN_MS = 24 * 60 * 60 * 1000;
    const elapsed = now - (user.lastDaily || 0);

    if (elapsed < COOLDOWN_MS) {
        const remainingMs = COOLDOWN_MS - elapsed;
        const remHours = Math.floor(remainingMs / (1000 * 60 * 60));
        const remMins = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60));
        return {
            claimed: false,
            message: `⏳ You already claimed your daily reward today! Come back in **${remHours}h ${remMins}m**.`
        };
    }

    const DAILY_POINTS = 200;
    user.points = (user.points || 0) + DAILY_POINTS;
    user.lastDaily = now;
    saveLevels();

    return {
        claimed: true,
        message: `🎁 **Daily Reward Claimed!** You received **+${DAILY_POINTS} 🪙 Points**!\n💰 Balance: **${user.points.toLocaleString()} 🪙 Points**\nBrowse new themes in \`/shop\`!`
    };
}

// Builds the Points Wallet Embed
function createPointsEmbed(member, userData) {
    const theme = CARD_THEMES[userData.equippedTheme] || CARD_THEMES.arcane;
    const inventory = userData.inventory || ['arcane'];
    const totalThemes = Object.keys(CARD_THEMES).length;
    const levelData = calculateLevelData(userData.xp || 0);

    const embed = new EmbedBuilder()
        .setAuthor({
            name: `${member.displayName}'s Wallet & Economy`,
            iconURL: member.user.displayAvatarURL({ dynamic: true })
        })
        .setColor(0x2BB6A6)
        .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
        .addFields(
            { name: '🪙 Points Balance', value: `**${(userData.points || 0).toLocaleString()}** Points`, inline: true },
            { name: '🎨 Equipped Theme', value: `${theme.emoji} **${theme.name}**`, inline: true },
            { name: '🎒 Themes Owned', value: `**${inventory.length}** / ${totalThemes} themes`, inline: true },
            { name: '⭐ Level & Rank', value: `Level **${levelData.level}** (${(userData.xp || 0).toLocaleString()} XP)`, inline: true },
            { name: '💬 Texts Sent', value: `**${(userData.messages || 0).toLocaleString()}**`, inline: true },
            { name: '🎙️ Call Time', value: `**${formatVoiceDuration(userData.voiceMinutes || 0)}**`, inline: true },
            { name: '💡 How to Earn More Points', value: '• **Chat in channels:** 5 - 10 pts per message\n• **Join Voice Channels:** 5 - 8 pts per minute\n• **Level Up:** `Level * 50` bonus pts!\n• **`/daily`:** Claim 200 pts every 24h\n• Spend points in `/shop` for crazy & cool card themes!', inline: false }
        )
        .setFooter({ text: 'null Economy • /shop • /buy • /equip • /daily' })
        .setTimestamp();

    return embed;
}

// ==========================================
// 🎮 HANGMAN MINIGAME ENGINE (100% Real Words & Accurate Rules)
// ==========================================

const HANGMAN_STAGES = [
`  +---+
  |   |
      |
      |
      |
      |
=========`,
`  +---+
  |   |
  O   |
      |
      |
      |
=========`,
`  +---+
  |   |
  O   |
  |   |
      |
      |
=========`,
`  +---+
  |   |
  O   |
 /|   |
      |
      |
=========`,
`  +---+
  |   |
  O   |
 /|\\  |
      |
      |
=========`,
`  +---+
  |   |
  O   |
 /|\\  |
 /    |
      |
=========`,
`  +---+
  |   |
  O   |
 /|\\  |
 / \\  |
      |
=========`
];

const HANGMAN_WORDS = {
    gaming: [
        { word: 'MINECRAFT', hint: 'Sandbox block building game' },
        { word: 'FORTNITE', hint: 'Battle Royale with building mechanics' },
        { word: 'VALORANT', hint: 'Tactical hero first-person shooter' },
        { word: 'POKEMON', hint: 'Gotta catch them all!' },
        { word: 'ROBLOX', hint: 'User-generated online gaming platform' },
        { word: 'ZELDA', hint: 'Hero with a sword and princess of Hyrule' },
        { word: 'OVERWATCH', hint: 'Team-based hero shooter by Blizzard' },
        { word: 'WITCHER', hint: 'Geralt of Rivia monster hunter' },
        { word: 'CYBERPUNK', hint: 'Night City open-world RPG' },
        { word: 'SKYRIM', hint: 'Dragons, shouts, and arrows in the knee' },
        { word: 'TERRARIA', hint: '2D sandbox adventure game' },
        { word: 'DISCORD', hint: 'Where gamers chat and stream' },
        { word: 'PLAYSTATION', hint: 'Sony video game console' },
        { word: 'NINTENDO', hint: 'Japanese gaming titan behind Mario' },
        { word: 'WARZONE', hint: 'Call of Duty free battle royale' },
        { word: 'ASSASSIN', hint: 'Creed series about stealth killers' }
    ],
    animals: [
        { word: 'ELEPHANT', hint: 'Largest land mammal with a trunk' },
        { word: 'DOLPHIN', hint: 'Smart aquatic mammal known for jumping' },
        { word: 'PENGUIN', hint: 'Flightless bird in Antarctica' },
        { word: 'KANGAROO', hint: 'Australian marsupial that hops' },
        { word: 'GIRAFFE', hint: 'Tallest animal with a long neck' },
        { word: 'OCTOPUS', hint: 'Sea creature with eight tentacles' },
        { word: 'CHEETAH', hint: 'Fastest land animal on Earth' },
        { word: 'FLAMINGO', hint: 'Pink bird that stands on one leg' },
        { word: 'CHAMELEON', hint: 'Lizard that changes skin color' },
        { word: 'PLATYPUS', hint: 'Duck-billed egg-laying mammal' },
        { word: 'HEDGEHOG', hint: 'Spiky small mammal that rolls into a ball' },
        { word: 'CROCODILE', hint: 'Ancient predatory reptile with strong jaws' },
        { word: 'BUTTERFLY', hint: 'Insect with colorful wings' }
    ],
    tech: [
        { word: 'ALGORITHM', hint: 'Step-by-step problem-solving instructions' },
        { word: 'JAVASCRIPT', hint: 'Programming language of the web' },
        { word: 'PYTHON', hint: 'Popular readable programming language' },
        { word: 'DATABASE', hint: 'Organized collection of stored data' },
        { word: 'COMPUTER', hint: 'Electronic calculating machine' },
        { word: 'ARTIFICIAL', hint: 'The "A" in AI' },
        { word: 'INTELLIGENCE', hint: 'The "I" in AI' },
        { word: 'INTERNET', hint: 'Global network of computers' },
        { word: 'FIREWALL', hint: 'Network security defense barrier' },
        { word: 'QUANTUM', hint: 'Physics theory powering futuristic computing' },
        { word: 'PROCESSOR', hint: 'The CPU chip brain of a machine' },
        { word: 'ENCRYPTION', hint: 'Scrambling data for digital privacy' }
    ],
    movies: [
        { word: 'INCEPTION', hint: 'Dream within a dream heist movie' },
        { word: 'TITANIC', hint: 'Ship that hit an iceberg in 1912' },
        { word: 'SPIDERMAN', hint: 'With great power comes great responsibility' },
        { word: 'GLADIATOR', hint: 'Are you not entertained in Rome?' },
        { word: 'BATMAN', hint: 'The Dark Knight defender of Gotham' },
        { word: 'INTERSTELLAR', hint: 'Space travel through a black hole' },
        { word: 'MATRIX', hint: 'Red pill or blue pill?' },
        { word: 'AVATAR', hint: 'Blue Na\'vi people on planet Pandora' },
        { word: 'HARRYPOTTER', hint: 'The boy wizard who lived' },
        { word: 'STARWARS', hint: 'Jedi and the Force in a galaxy far away' }
    ],
    general: [
        { word: 'CHOCOLATE', hint: 'Sweet cocoa treat loved worldwide' },
        { word: 'SUNSHINE', hint: 'Warm golden rays from the sky' },
        { word: 'MOUNTAIN', hint: 'Giant natural peak rising into clouds' },
        { word: 'ADVENTURE', hint: 'Exciting and daring journey' },
        { word: 'UNIVERSE', hint: 'Everything that exists in space and time' },
        { word: 'MYSTERY', hint: 'Something unexplained or secret' },
        { word: 'VACATION', hint: 'Time off from work or school to relax' },
        { word: 'TELESCOPE', hint: 'Instrument used to observe distant stars' },
        { word: 'PARADISE', hint: 'An ideal place of perfect happiness' },
        { word: 'CELEBRATION', hint: 'Festive gathering for a special event' },
        { word: 'HOSPITAL', hint: 'Place where sick people receive care' },
        { word: 'LIBRARY', hint: 'Building filled with shelves of books' }
    ]
};

// Map of active games: channelId -> GameState
const activeHangmanGames = new Map();

function startHangmanGame(channelId, categoryChoice = 'all', starterUser = null) {
    if (activeHangmanGames.has(channelId)) {
        const old = activeHangmanGames.get(channelId);
        if (old.timeout) clearTimeout(old.timeout);
        activeHangmanGames.delete(channelId);
    }

    let category = (categoryChoice || 'all').toLowerCase();
    const validCategories = Object.keys(HANGMAN_WORDS);
    if (!validCategories.includes(category)) {
        category = validCategories[Math.floor(Math.random() * validCategories.length)];
    }

    let pool = [];
    if (categoryChoice === 'all' || !validCategories.includes(categoryChoice.toLowerCase())) {
        for (const cat of validCategories) pool.push(...HANGMAN_WORDS[cat].map(w => ({ ...w, category: cat })));
    } else {
        pool = HANGMAN_WORDS[category].map(w => ({ ...w, category }));
    }

    const item = pool[Math.floor(Math.random() * pool.length)];
    const word = item.word.toUpperCase();

    const game = {
        channelId,
        word,
        hint: item.hint,
        category: item.category.toUpperCase(),
        guessedLetters: new Set(),
        wrongGuesses: new Set(),
        starterUser: starterUser?.displayName || starterUser?.username || 'Player',
        starterId: starterUser?.id,
        lives: 6,
        lastActivity: Date.now(),
        timeout: null
    };

    activeHangmanGames.set(channelId, game);

    // Auto-terminate after 3 minutes of inactivity
    game.timeout = setTimeout(() => {
        if (activeHangmanGames.get(channelId) === game) {
            activeHangmanGames.delete(channelId);
        }
    }, 180000);

    return game;
}

function renderHangmanDisplay(game) {
    const stageIdx = Math.min(game.wrongGuesses.size, HANGMAN_STAGES.length - 1);
    const gallows = HANGMAN_STAGES[stageIdx];

    const displayWord = game.word.split('').map(letter => {
        if (game.guessedLetters.has(letter)) {
            return letter;
        }
        return '\\_';
    }).join(' ');

    const wrongList = game.wrongGuesses.size > 0 
        ? Array.from(game.wrongGuesses).join(', ') 
        : '*None*';

    const hearts = '❤️'.repeat(game.lives) + '🖤'.repeat(6 - game.lives);

    const embed = new EmbedBuilder()
        .setTitle(`🎮 Hangman Game — [${game.category}]`)
        .setColor(game.lives <= 2 ? 0xED4245 : 0x2BB6A6)
        .setDescription(`\`\`\`\n${gallows}\n\`\`\`\n` +
            `🔤 **Word:** **${displayWord}** (${game.word.length} letters)\n` +
            `💡 **Hint:** *${game.hint}*\n` +
            `❌ **Wrong Guesses:** \`${wrongList}\`\n` +
            `❤️ **Lives:** ${hearts} (${game.lives}/6)\n\n` +
            `*💬 Type a letter (e.g. \`E\`) or the full word in chat to guess!*\n` +
            `*Type \`!forfeit\` to give up.*`
        )
        .setFooter({ text: `Started by ${game.starterUser} • Anyone in this channel can guess!` });

    return embed;
}

function processHangmanGuess(game, guessText, guessingUser, guildId) {
    const raw = (guessText || '').toUpperCase().trim();
    if (!raw) return null;

    if (game.timeout) clearTimeout(game.timeout);
    game.timeout = setTimeout(() => {
        if (activeHangmanGames.get(game.channelId) === game) {
            activeHangmanGames.delete(game.channelId);
        }
    }, 180000);

    const userName = guessingUser.displayName || guessingUser.username;

    // Full Word Guess
    if (raw.length > 1) {
        if (raw === game.word) {
            for (const char of game.word) game.guessedLetters.add(char);
            activeHangmanGames.delete(game.channelId);

            const userRec = getOrCreateUser(guildId, guessingUser.id, userName);
            userRec.points = (userRec.points || 0) + 100;
            userRec.xp = (userRec.xp || 0) + 75;
            saveLevels();

            return {
                status: 'win',
                word: game.word,
                message: `🎉 **VICTORY!** <@${guessingUser.id}> guessed the full word correctly: **${game.word}**!\n🪙 **+100 Points** & **+75 XP** awarded!`
            };
        } else {
            game.lives = Math.max(0, game.lives - 1);
            game.wrongGuesses.add(raw.slice(0, 10));

            if (game.lives <= 0) {
                activeHangmanGames.delete(game.channelId);
                return {
                    status: 'lose',
                    word: game.word,
                    message: `💀 **GAME OVER!** "${raw}" was not the word.\nThe correct word was **${game.word}** (*${game.hint}*)!`
                };
            }

            return {
                status: 'wrong_word',
                message: `❌ "${raw}" is not the word! Lost 1 life. (${game.lives}/6 lives left)`
            };
        }
    }

    // Single Letter Guess
    const letter = raw;
    if (!/^[A-Z]$/.test(letter)) return null;

    if (game.guessedLetters.has(letter) || game.wrongGuesses.has(letter)) {
        return {
            status: 'already_guessed',
            message: `⚠️ Letter **${letter}** was already guessed!`
        };
    }

    if (game.word.includes(letter)) {
        game.guessedLetters.add(letter);

        const userRec = getOrCreateUser(guildId, guessingUser.id, userName);
        userRec.points = (userRec.points || 0) + 10;
        saveLevels();

        const won = game.word.split('').every(ch => game.guessedLetters.has(ch));
        if (won) {
            activeHangmanGames.delete(game.channelId);
            userRec.points = (userRec.points || 0) + 60;
            userRec.xp = (userRec.xp || 0) + 50;
            saveLevels();

            return {
                status: 'win',
                word: game.word,
                message: `🎉 **VICTORY!** <@${guessingUser.id}> revealed the final letter!\nThe word was **${game.word}**! 🪙 **+70 Points** & **+50 XP** awarded!`
            };
        }

        return {
            status: 'correct_letter',
            letter,
            message: `✅ Yes! The letter **${letter}** is in the word! (+10 🪙 Points)`
        };
    } else {
        game.wrongGuesses.add(letter);
        game.lives = Math.max(0, game.lives - 1);

        if (game.lives <= 0) {
            activeHangmanGames.delete(game.channelId);
            return {
                status: 'lose',
                word: game.word,
                message: `💀 **GAME OVER!** The letter **${letter}** is not in the word.\nThe correct word was **${game.word}** (*${game.hint}*)!`
            };
        }

        return {
            status: 'wrong_letter',
            letter,
            message: `❌ No, **${letter}** is not in the word! (${game.lives}/6 lives left)`
        };
    }
}

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
        .setDescription('Ask null anything (Text via Groq, Images/GIFs via Gemini Vision)')
        .addStringOption(option =>
            option.setName('question')
                .setDescription('What do you want to ask null?')
                .setRequired(true)
        )
        .addAttachmentOption(option =>
            option.setName('image')
                .setDescription('Optional image or GIF for Gemini Vision analysis')
                .setRequired(false)
        ),
    new SlashCommandBuilder()
        .setName('rank')
        .setDescription('Check your or another member\'s level, XP, texts sent, and minutes in call')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The member whose rank card you want to view (defaults to yourself)')
                .setRequired(false)
        ),
    new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('View the server leaderboard (Top 10 members)')
        .addStringOption(option =>
            option.setName('type')
                .setDescription('Sort leaderboard by XP or Points')
                .setRequired(false)
                .addChoices(
                    { name: '🏆 Level & XP (Default)', value: 'xp' },
                    { name: '🪙 Points Balance', value: 'points' }
                )
        ),
    new SlashCommandBuilder()
        .setName('shop')
        .setDescription('Browse the rank card themes shop and view theme prices'),
    new SlashCommandBuilder()
        .setName('buy')
        .setDescription('Purchase a rank card theme with your points')
        .addStringOption(option =>
            option.setName('theme')
                .setDescription('The theme you want to purchase')
                .setRequired(true)
                .addChoices(
                    { name: '⚡ Cyberpunk Neon (400 pts)', value: 'cyberpunk' },
                    { name: '🌌 Cosmic Galaxy (500 pts)', value: 'galaxy' },
                    { name: '🩸 Bloodmoon Crimson (450 pts)', value: 'crimson' },
                    { name: '🌿 Forest Emerald (350 pts)', value: 'nature' },
                    { name: '🌅 Golden Sunset (350 pts)', value: 'sunset' },
                    { name: '🌊 Abyssal Ocean (400 pts)', value: 'ocean' }
                )
        ),
    new SlashCommandBuilder()
        .setName('equip')
        .setDescription('Equip an owned rank card theme to your profile')
        .addStringOption(option =>
            option.setName('theme')
                .setDescription('The theme you want to equip')
                .setRequired(true)
                .addChoices(
                    { name: '💎 Classic Arcane (Default)', value: 'arcane' },
                    { name: '⚡ Cyberpunk Neon', value: 'cyberpunk' },
                    { name: '🌌 Cosmic Galaxy', value: 'galaxy' },
                    { name: '🩸 Bloodmoon Crimson', value: 'crimson' },
                    { name: '🌿 Forest Emerald', value: 'nature' },
                    { name: '🌅 Golden Sunset', value: 'sunset' },
                    { name: '🌊 Abyssal Ocean', value: 'ocean' }
                )
        ),
    new SlashCommandBuilder()
        .setName('daily')
        .setDescription('Claim your daily reward of 200 points! (Once every 24 hours)'),
    new SlashCommandBuilder()
        .setName('points')
        .setDescription('Check your points balance, inventory, and equipped card theme')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('User to check points for (defaults to yourself)')
                .setRequired(false)
        ),
    new SlashCommandBuilder()
        .setName('hangman')
        .setDescription('Start an interactive Hangman word guessing game in this channel!')
        .addStringOption(option =>
            option.setName('category')
                .setDescription('Word category to play with')
                .setRequired(false)
                .addChoices(
                    { name: '🎲 Random / All (Default)', value: 'all' },
                    { name: '🎮 Gaming & Video Games', value: 'gaming' },
                    { name: '🦁 Animals & Wildlife', value: 'animals' },
                    { name: '💻 Tech, Coding & AI', value: 'tech' },
                    { name: '🎬 Movies & Cinema', value: 'movies' },
                    { name: '🌍 General & Fun Words', value: 'general' }
                )
        ),
    new SlashCommandBuilder()
        .setName('hangman-stop')
        .setDescription('Stop and forfeit the active Hangman game in this channel'),
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

    // 1. Leveling Activity Tracking (Increments texts sent & awards message XP)
    if (message.guild) {
        trackMessageForLeveling(message);

        // Fast text commands fallback: !rank / !level / !leaderboard / !top
        const lower = message.content.trim().toLowerCase();
        if (lower === '!rank' || lower === '!level' || lower.startsWith('!rank ') || lower.startsWith('!level ')) {
            const targetUser = message.mentions.users.first() || message.author;
            const targetMember = await message.guild.members.fetch(targetUser.id).catch(() => null) || message.member;
            const userData = getOrCreateUser(message.guild.id, targetUser.id, targetMember.displayName || targetUser.username);

            const cardBuffer = await generateRankCardImage(targetMember, userData);
            if (cardBuffer) {
                const attachment = new AttachmentBuilder(cardBuffer, { name: 'rank-card.png' });
                return message.reply({ files: [attachment] }).catch(() => {});
            } else {
                const cardEmbed = createRankCardEmbed(targetMember, userData);
                return message.reply({ embeds: [cardEmbed] }).catch(() => {});
            }
        }

        if (lower === '!leaderboard' || lower === '!top' || lower === '!lb' || lower.startsWith('!top ') || lower.startsWith('!leaderboard ')) {
            const isPoints = lower.includes('point');
            const lbEmbed = createLeaderboardEmbed(message.guild, message.member, isPoints ? 'points' : 'xp');
            return message.reply({ embeds: [lbEmbed] }).catch(() => {});
        }

        if (lower === '!shop') {
            const userData = getOrCreateUser(message.guild.id, message.author.id, message.member?.displayName || message.author.username);
            const shopEmbed = createShopEmbed(userData);
            return message.reply({ embeds: [shopEmbed] }).catch(() => {});
        }

        if (lower.startsWith('!buy ') || lower === '!buy') {
            const themeKey = lower.replace('!buy', '').trim();
            if (!themeKey) {
                return message.reply('💡 Usage: `!buy <theme>` (e.g. `!buy cyberpunk`, `!buy galaxy`, `!buy nature`). Type `!shop` to see themes.').catch(() => {});
            }
            const res = handleBuyTheme(message.guild.id, message.author.id, message.member?.displayName || message.author.username, themeKey);
            return message.reply(res.message).catch(() => {});
        }

        if (lower.startsWith('!equip ') || lower === '!equip') {
            const themeKey = lower.replace('!equip', '').trim();
            if (!themeKey) {
                return message.reply('💡 Usage: `!equip <theme>` (e.g. `!equip cyberpunk`, `!equip arcane`). Type `!shop` to view your owned themes.').catch(() => {});
            }
            const res = handleEquipTheme(message.guild.id, message.author.id, message.member?.displayName || message.author.username, themeKey);
            return message.reply(res.message).catch(() => {});
        }

        if (lower === '!daily') {
            const res = handleDailyReward(message.guild.id, message.author.id, message.member?.displayName || message.author.username);
            return message.reply(res.message).catch(() => {});
        }

        if (lower === '!points' || lower === '!balance' || lower.startsWith('!points ') || lower.startsWith('!balance ')) {
            const targetUser = message.mentions.users.first() || message.author;
            const targetMember = await message.guild.members.fetch(targetUser.id).catch(() => null) || message.member;
            const userData = getOrCreateUser(message.guild.id, targetUser.id, targetMember.displayName || targetUser.username);
            const embed = createPointsEmbed(targetMember, userData);
            return message.reply({ embeds: [embed] }).catch(() => {});
        }

        // Hangman command: !hangman [category] / !hm [category]
        if (lower === '!hangman' || lower === '!hm' || lower.startsWith('!hangman ') || lower.startsWith('!hm ')) {
            const parts = lower.split(/\s+/);
            const category = parts[1] || 'all';

            if (category === 'stop') {
                if (activeHangmanGames.has(message.channel.id)) {
                    const game = activeHangmanGames.get(message.channel.id);
                    if (game.timeout) clearTimeout(game.timeout);
                    activeHangmanGames.delete(message.channel.id);
                    return message.reply(`⏹️ Hangman game stopped! The secret word was **${game.word}** (*${game.hint}*).`).catch(() => {});
                } else {
                    return message.reply('❌ No active Hangman game in this channel! Start one with `!hangman`.').catch(() => {});
                }
            }

            const game = startHangmanGame(message.channel.id, category, message.author);
            const embed = renderHangmanDisplay(game);
            return message.reply({ content: `🎮 **Hangman game started by <@${message.author.id}>!**`, embeds: [embed] }).catch(() => {});
        }

        // Hangman active game letter / word guesser
        if (activeHangmanGames.has(message.channel.id)) {
            const game = activeHangmanGames.get(message.channel.id);
            const text = message.content.trim();
            const textLower = text.toLowerCase();

            if (textLower === '!forfeit' || textLower === '!giveup' || textLower === '!endhangman') {
                if (game.timeout) clearTimeout(game.timeout);
                activeHangmanGames.delete(message.channel.id);
                return message.reply(`🏳️ **Game Forfeited!** The secret word was **${game.word}** (*${game.hint}*). Start a new game with \`!hangman\`!`).catch(() => {});
            }

            let guess = null;
            if (/^[a-zA-Z]$/.test(text)) {
                guess = text;
            } else if (/^!(g|guess)\s+([a-zA-Z]+)$/i.test(text)) {
                const match = text.match(/^!(g|guess)\s+([a-zA-Z]+)$/i);
                if (match) guess = match[2];
            }

            if (guess) {
                const result = processHangmanGuess(game, guess, message.member || message.author, message.guild.id);
                if (result) {
                    if (result.status === 'already_guessed') {
                        return message.reply(result.message).catch(() => {});
                    } else {
                        const updatedEmbed = renderHangmanDisplay(game);
                        return message.reply({ content: result.message, embeds: [updatedEmbed] }).catch(() => {});
                    }
                }
            }
        }
    }

    // Check if bot was mentioned (@null)
    const isMentioned = message.mentions.users.has(client.user.id) && !message.mentions.everyone && !message.content.includes('@here');

    // Check if user replied to a message
    let isReplyToBot = false;
    let referencedMessage = null;
    if (message.reference && message.reference.messageId) {
        try {
            referencedMessage = await message.channel.messages.fetch(message.reference.messageId).catch(() => null);
            if (referencedMessage && referencedMessage.author.id === client.user.id) {
                isReplyToBot = true;
            }
        } catch {}
    }

    // Allow DMs as well
    const isDM = !message.guild;

    if (!isMentioned && !isReplyToBot && !isDM) return;

    // Extract images and GIFs from current message
    let allImages = extractImagesFromMessage(message);

    // If Tenor/Giphy link in message but Discord embeds haven't populated yet, wait 600ms and refetch
    if (allImages.length === 0 && /(tenor\.com|giphy\.com)/i.test(message.content)) {
        await new Promise(r => setTimeout(r, 600));
        const refreshed = await message.channel.messages.fetch(message.id).catch(() => null);
        if (refreshed) {
            allImages = extractImagesFromMessage(refreshed);
        }
    }

    // Extract images and context if replying to an image or message
    let replyContext = '';
    if (referencedMessage) {
        const refImages = extractImagesFromMessage(referencedMessage);
        if (refImages.length > 0) {
            allImages = [...allImages, ...refImages];
            const authorName = referencedMessage.member?.displayName || referencedMessage.author.username;
            replyContext = ` (User is replying to an image/GIF from ${authorName}${referencedMessage.content ? `: "${referencedMessage.content}"` : ''})`;
        } else if (referencedMessage.content) {
            const authorName = referencedMessage.member?.displayName || referencedMessage.author.username;
            replyContext = ` (Replying to ${authorName}: "${referencedMessage.content}")`;
        }
    }

    // Clean @mention from prompt text
    const botMentionRegex = new RegExp(`<@!?${client.user.id}>`, 'g');
    let cleanPrompt = message.content.replace(botMentionRegex, '').trim();

    // Default prompt when user sends an image/GIF with no text
    if (!cleanPrompt) {
        if (allImages.length > 0) {
            cleanPrompt = 'תאר מה רואים בתמונה או בגיף הזה, ותגיב על זה בצורה מעניינת ומפורטת';
        } else {
            cleanPrompt = 'שלום!';
        }
    }

    if (replyContext) {
        cleanPrompt += replyContext;
    }

    const speakerName = message.member?.displayName || message.author.username;

    // Show typing status in Discord
    try {
        await message.channel.sendTyping();
    } catch {}

    try {
        // Fetch small batch of members to ensure context is populated
        if (message.guild && message.guild.members.cache.size < 20) {
            await message.guild.members.fetch({ limit: 50 }).catch(() => {});
        }

        const serverContext = buildServerContext(message);

        // Generate AI response (routes to Gemini Vision if images present, or Groq if text only)
        const aiReply = await generateAIResponse(cleanPrompt, message.channel.id, serverContext, allImages);

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
        const attachment = interaction.options.getAttachment('image');
        const imageUrls = [];
        if (attachment) {
            const isImg = attachment.contentType?.startsWith('image/') ||
                /\.(png|jpe?g|gif|webp|bmp|tiff)$/i.test(attachment.name || attachment.url);
            if (isImg && attachment.url) {
                imageUrls.push(attachment.url);
            }
        }

        await interaction.deferReply();

        try {
            const serverContext = buildServerContext(interaction);
            const aiReply = await generateAIResponse(question, interaction.channelId, serverContext, imageUrls);

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

    // --- /rank ---
    if (commandName === 'rank') {
        if (!interaction.guild) {
            return interaction.reply({ content: '❌ Leveling is server-specific! Please run this command inside a server.', ephemeral: true });
        }

        await interaction.deferReply();

        const targetUser = interaction.options.getUser('user') || interaction.user;
        const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null) || interaction.member;

        const userData = getOrCreateUser(interaction.guild.id, targetUser.id, targetMember.displayName || targetUser.username);

        const cardBuffer = await generateRankCardImage(targetMember, userData);
        if (cardBuffer) {
            const attachment = new AttachmentBuilder(cardBuffer, { name: 'rank-card.png' });
            return interaction.editReply({ files: [attachment] });
        } else {
            const cardEmbed = createRankCardEmbed(targetMember, userData);
            return interaction.editReply({ embeds: [cardEmbed] });
        }
    }

    // --- /leaderboard ---
    if (commandName === 'leaderboard') {
        if (!interaction.guild) {
            return interaction.reply({ content: '❌ Leaderboard is server-specific! Please run this command inside a server.', ephemeral: true });
        }

        const type = interaction.options.getString('type') || 'xp';
        const lbEmbed = createLeaderboardEmbed(interaction.guild, interaction.member, type);
        return interaction.reply({ embeds: [lbEmbed] });
    }

    // --- /shop ---
    if (commandName === 'shop') {
        if (!interaction.guild) {
            return interaction.reply({ content: '❌ Shop is server-specific! Please run this command inside a server.', ephemeral: true });
        }

        const userData = getOrCreateUser(interaction.guild.id, interaction.user.id, interaction.member?.displayName || interaction.user.username);
        const shopEmbed = createShopEmbed(userData);
        return interaction.reply({ embeds: [shopEmbed] });
    }

    // --- /buy ---
    if (commandName === 'buy') {
        if (!interaction.guild) {
            return interaction.reply({ content: '❌ Shop is server-specific! Please run this command inside a server.', ephemeral: true });
        }

        const themeKey = interaction.options.getString('theme');
        const res = handleBuyTheme(interaction.guild.id, interaction.user.id, interaction.member?.displayName || interaction.user.username, themeKey);
        return interaction.reply({ content: res.message });
    }

    // --- /equip ---
    if (commandName === 'equip') {
        if (!interaction.guild) {
            return interaction.reply({ content: '❌ Card themes are server-specific! Please run this command inside a server.', ephemeral: true });
        }

        const themeKey = interaction.options.getString('theme');
        const res = handleEquipTheme(interaction.guild.id, interaction.user.id, interaction.member?.displayName || interaction.user.username, themeKey);
        return interaction.reply({ content: res.message });
    }

    // --- /daily ---
    if (commandName === 'daily') {
        if (!interaction.guild) {
            return interaction.reply({ content: '❌ Daily reward is server-specific! Please run this command inside a server.', ephemeral: true });
        }

        const res = handleDailyReward(interaction.guild.id, interaction.user.id, interaction.member?.displayName || interaction.user.username);
        return interaction.reply({ content: res.message });
    }

    // --- /points ---
    if (commandName === 'points') {
        if (!interaction.guild) {
            return interaction.reply({ content: '❌ Economy is server-specific! Please run this command inside a server.', ephemeral: true });
        }

        const targetUser = interaction.options.getUser('user') || interaction.user;
        const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null) || interaction.member;
        const userData = getOrCreateUser(interaction.guild.id, targetUser.id, targetMember.displayName || targetUser.username);

        const embed = createPointsEmbed(targetMember, userData);
        return interaction.reply({ embeds: [embed] });
    }

    // --- /hangman ---
    if (commandName === 'hangman') {
        if (!interaction.guild) {
            return interaction.reply({ content: '❌ Hangman is server-specific! Please run this command inside a server channel.', ephemeral: true });
        }

        const category = interaction.options.getString('category') || 'all';
        const game = startHangmanGame(interaction.channelId, category, interaction.user);
        const embed = renderHangmanDisplay(game);

        return interaction.reply({
            content: `🎮 **Hangman started by <@${interaction.user.id}>!**`,
            embeds: [embed]
        });
    }

    // --- /hangman-stop ---
    if (commandName === 'hangman-stop') {
        if (!activeHangmanGames.has(interaction.channelId)) {
            return interaction.reply({ content: '❌ No active Hangman game in this channel! Start one with `/hangman`.', ephemeral: true });
        }

        const game = activeHangmanGames.get(interaction.channelId);
        if (game.timeout) clearTimeout(game.timeout);
        activeHangmanGames.delete(interaction.channelId);

        return interaction.reply({ content: `⏹️ Hangman game stopped! The secret word was **${game.word}** (*${game.hint}*).` });
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
        if (process.env.GROQ_API_KEY) activeAiList.push('Groq (Text & Web Search)');
        if (process.env.GEMINI_API_KEY) activeAiList.push('Gemini Vision (Images & GIFs)');
        if (process.env.OPENROUTER_API_KEY) activeAiList.push('OpenRouter (Backup)');

        const aiStatus = activeAiList.length > 0
            ? `🟢 Active (${activeAiList.join(' | ')})`
            : '🟡 Waiting for Key (Add GROQ_API_KEY / GEMINI_API_KEY in .env)';

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
                { name: '🏆 Leveling & Rank (Arcade System)', value: '`/rank [user]` (or `!rank`) — Check rank card (Level, XP, texts sent, call time, points)\n`/leaderboard [type]` (or `!top`) — Server leaderboard (Top 10 by XP or Points)' },
                { name: '🪙 Economy & Card Themes Shop', value: '`/shop` (or `!shop`) — Browse cool & natural rank card themes\n`/buy <theme>` (or `!buy <theme>`) — Purchase a card theme with points\n`/equip <theme>` (or `!equip <theme>`) — Equip an owned card theme\n`/daily` (or `!daily`) — Claim daily reward (+200 points every 24h)\n`/points [user]` (or `!points`) — View wallet, points, and owned themes' },
                { name: '🎮 Arcade Minigames', value: '`/hangman [category]` (or `!hangman`) — Interactive Hangman game with real words & ASCII art!\n• Type single letters in chat (e.g. `e`, `a`) or full words to guess!\n• Earn points & XP for finding letters and winning!\n`/hangman-stop` (or `!forfeit`) — Forfeit active game' },
                { name: '🧠 AI Chat & Web Search', value: '• **Mention `@null`** in any channel to chat!\n• **Reply to null\'s messages** to continue the conversation!\n• `/ask <question> [image]` — Ask AI (Groq for text, Gemini Vision for images/GIFs)\n• Remembers **50 messages** of history and knows server members & roles!' },
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
