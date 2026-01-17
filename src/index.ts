import { InteractionType, InteractionResponseType, verifyKey } from 'discord-interactions';
import { getISOWeek, getYear } from 'date-fns';
import { handleViikonGeimeri } from './commands';
import { Env } from './types';
import { updateLiigaScores } from './liiga';


export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        if (request.method === 'POST') {
            const signature = request.headers.get('x-signature-ed25519');
            const timestamp = request.headers.get('x-signature-timestamp');
            const body = await request.text();

            const isValidRequest = await isValidRequestSignature(body, signature, timestamp, env.DISCORD_PUBLIC_KEY);
            if (!isValidRequest) {
                return new Response('Bad request signature', { status: 401 });
            }

            const interaction = JSON.parse(body);

            if (interaction.type === InteractionType.PING) {
                return new Response(JSON.stringify({ type: InteractionResponseType.PONG }), {
                    headers: { 'Content-Type': 'application/json' },
                });
            }

            if (interaction.type === InteractionType.APPLICATION_COMMAND) {
                const { name } = interaction.data;
                if (name === 'viikongeimeri') {
                    return handleViikonGeimeri(interaction, env);
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
        ctx.waitUntil(trackPlaytimes(env));

        // Sunday 21:00 (approx): Send weekly message
        // Note: Cloudflare Crons are UTC.
        if (event.cron === "0 21 * * 0") {
            ctx.waitUntil(sendWeeklySummary(env));
        }

        // Liiga tracking logic
        ctx.waitUntil(updateLiigaScores(env));
    },

};

async function isValidRequestSignature(body: string, signature: string | null, timestamp: string | null, publicKey: string): Promise<boolean> {
    if (!signature || !timestamp) return false;
    return verifyKey(body, signature, timestamp, publicKey);
}

async function trackPlaytimes(env: Env) {
    const GUILD_ID = env.DISCORD_GUILD_ID;
    if (!GUILD_ID) return;

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
