import { InteractionType, InteractionResponseType, verifyKey } from 'discord-interactions';
import { getISOWeek, getYear } from 'date-fns';
import { handleViikonGeimeri, handleCountdown } from './commands';
import { Env } from './types';
import { updateLiigaScores } from './liiga';

// Memory cache for optimizations
let memoryCountdown: { targetDate: string; description: string } | null = null;
let lastNickname: string | null = null;
let lastCountdownFetch: number = 0;
export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        if (request.method === 'POST') {
            const signature = request.headers.get('x-signature-ed25519');
            const timestamp = request.headers.get('x-signature-timestamp');
            const body = await request.text();
            console.log(`[Interaction] Received interaction request`);

            const isValidRequest = await isValidRequestSignature(body, signature, timestamp, env.DISCORD_PUBLIC_KEY);
            if (!isValidRequest) {
                return new Response('Bad request signature', { status: 401 });
            }

            const interaction = JSON.parse(body);

            if (interaction.type === InteractionType.PING) {
                console.log(`[Interaction] Responding to PING`);
                return new Response(JSON.stringify({ type: InteractionResponseType.PONG }), {
                    headers: { 'Content-Type': 'application/json' },
                });
            }

            if (interaction.type === InteractionType.APPLICATION_COMMAND) {
                const { name } = interaction.data;
                console.log(`[Interaction] Command received: ${name}`);
                if (name === 'viikongeimeri') {
                    return handleViikonGeimeri(interaction, env);
                }
                if (name === 'countdown') {
                    return handleCountdown(interaction, env);
                }
            }
        }

        return new Response('Not Found', { status: 404 });
    },

    async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
        const now = new Date();
        const hour = now.getUTCHours();
        const minute = now.getUTCMinutes();
        const day = now.getUTCDay(); // 0 is Sunday

        // Every minute: Track playtimes
        console.log(`[Scheduled] Job started. Cron: ${event.cron}`);
        ctx.waitUntil(trackPlaytimes(env));

        // Sunday 21:00 (approx): Send weekly message
        // Note: Cloudflare Crons are UTC.
        if (event.cron === "0 21 * * 0") {
            console.log(`[Scheduled] Sending weekly summary`);
            ctx.waitUntil(sendWeeklySummary(env));
        }

        // Liiga tracking logic
        ctx.waitUntil(updateLiigaScores(env));

        // Countdown tracking logic
        ctx.waitUntil(updateCountdownStatus(env));
    },

};

async function updateCountdownStatus(env: Env) {
    const nowTs = Date.now();

    // Only fetch from KV if cache is older than 5 minutes
    if (!memoryCountdown || (nowTs - lastCountdownFetch > 5 * 60 * 1000)) {
        console.log(`[Countdown] Fetching from KV (Cache expired or empty)`);
        memoryCountdown = await env.KV.get('active_countdown', { type: 'json', cacheTtl: 60 });
        lastCountdownFetch = nowTs;
    }

    if (!memoryCountdown) return;

    const now = new Date();
    const targetDate = new Date(memoryCountdown.targetDate);
    const diff = targetDate.getTime() - now.getTime();

    // If more than 24h passed, remove the countdown
    if (diff < -24 * 60 * 60 * 1000) {
        console.log(`[Countdown] Finished and 24h passed. Cleaning up.`);
        await env.KV.delete('active_countdown');
        memoryCountdown = null;
        await updateBotNickname(env, ''); // Reset nickname
        return;
    }

    let nickname = '';
    if (diff > 0) {
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

        const dd = String(days).padStart(2, '0');
        const hh = String(hours).padStart(2, '0');
        const mm = String(minutes).padStart(2, '0');

        nickname = `${dd}:${hh}:${mm} ${memoryCountdown.description}`;
    } else {
        nickname = `00:00:00 ${memoryCountdown.description}`;
    }

    // Discord nickname limit is 32 characters
    if (nickname.length > 32) {
        nickname = nickname.substring(0, 29) + '...';
    }

    // Only update if nickname changed to minimize Discord API writes
    if (nickname !== lastNickname) {
        await updateBotNickname(env, nickname);
        lastNickname = nickname;
    }
}

async function updateBotNickname(env: Env, nickname: string) {
    const GUILD_ID = env.DISCORD_GUILD_ID;
    if (!GUILD_ID) return;

    console.log(`[Countdown] Updating nickname to: ${nickname}`);

    try {
        const response = await fetch(`https://discord.com/api/v10/guilds/${GUILD_ID}/members/@me`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bot ${env.DISCORD_TOKEN}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                nick: nickname
            })
        });

        if (!response.ok) {
            console.error(`[Countdown] Failed to update nickname: ${await response.text()}`);
        }
    } catch (err) {
        console.error(`[Countdown] Error updating nickname:`, err);
    }
}

async function isValidRequestSignature(body: string, signature: string | null, timestamp: string | null, publicKey: string): Promise<boolean> {
    if (!signature || !timestamp) return false;
    return verifyKey(body, signature, timestamp, publicKey);
}

async function trackPlaytimes(env: Env) {
    const GUILD_ID = env.DISCORD_GUILD_ID;
    if (!GUILD_ID) {
        console.warn(`[Tracking] DISCORD_GUILD_ID is not set`);
        return;
    }

    console.log(`[Tracking] Starting playtime tracking for guild: ${GUILD_ID}`);

    try {
        const response = await fetch(`https://discord.com/api/guilds/${GUILD_ID}/widget.json`);
        if (!response.ok) return;

        const data: any = await response.json();
        const members = data.members || [];
        const now = new Date();
        const week = getISOWeek(now);
        const year = getYear(now);
        const nowIso = now.toISOString();

        for (const member of members) {
            if (!member.game?.name) {
                continue;
            }
            const username = `${member.username}#${member.discriminator}`;
            const gameName = member.game.name;

            // Update or Insert session
            // Logic: If there is a session for this user/game/week/year that was seen in the last 3 minutes, update it.
            // Otherwise, start a new session.
            const lastSeenLimit = new Date(now.getTime() - 3 * 60000).toISOString();

            const existing = await env.DB.prepare(
                `SELECT start_time FROM playtimes 
                    WHERE username = ? AND game_name = ? AND week = ? AND year = ? AND last_seen >= ?
                    ORDER BY last_seen DESC LIMIT 1`
            ).bind(username, gameName, week, year, lastSeenLimit).first<{ start_time: string }>();

            if (existing) {
                await env.DB.prepare(
                    `UPDATE playtimes SET last_seen = ?, total_minutes = total_minutes + 1 
                        WHERE username = ? AND game_name = ? AND week = ? AND year = ? AND start_time = ?`
                ).bind(nowIso, username, gameName, week, year, existing.start_time).run();
            } else {
                await env.DB.prepare(
                    `INSERT INTO playtimes (username, game_name, start_time, last_seen, total_minutes, week, year)
                        VALUES (?, ?, ?, ?, 1, ?, ?)`
                ).bind(username, gameName, nowIso, nowIso, week, year).run();
            }
        }
    } catch (err) {
        console.error('Error tracking playtimes:', err);
    }
}

async function sendWeeklySummary(env: Env) {
    const now = new Date();
    const week = getISOWeek(now);
    const year = getYear(now);

    try {
        // 1. Get the winner (#1)
        const top = await env.DB.prepare(
            `SELECT username FROM playtimes 
			 WHERE week = ? AND year = ? 
			 GROUP BY username 
			 ORDER BY SUM(total_minutes) DESC LIMIT 1`
        ).bind(week, year).first<{ username: string }>();

        if (!top) return;

        const winnerName = top.username.split('#')[0];
        const message = `${winnerName} äiä o viikon geimeri, gz!!!`;

        // 2. Fetch the full stats using the slash command logic (mocked interaction)
        // Or just perform a REST call to Discord to post the message.
        // For simplicity, we just send a text message with the winner.
        // If we want the full embed, we should extract the embed building logic to a helper.

        const channelId = env.DISCORD_CHANNEL_ID;
        if (!channelId) return;

        await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
            method: 'POST',
            headers: {
                'Authorization': `Bot ${env.DISCORD_TOKEN}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                content: `**${winnerName} äiä o viikon geimeri, gz!!!**\n\nKäytä \`/viikongeimeri\` nähdäksesi täydet tilastot!`
            })
        });

    } catch (err) {
        console.error('Error sending weekly summary:', err);
    }
}
