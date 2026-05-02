import { getISOWeek, getYear } from 'date-fns';
import { Env } from '../types';
import { normalizeUsername, resolveAlias, getKnownUser, sendDiscordMessage } from '../utils';
import { getWeeklyStats } from './logic';

export async function trackPlaytimes(env: Env) {
    const GUILD_ID = env.DISCORD_GUILD_ID;
    if (!GUILD_ID) {
        console.warn(`[Tracking] DISCORD_GUILD_ID is not set`);
        return;
    }

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
            if (!member.game?.name) continue;

            let username = normalizeUsername(`${member.username}#${member.discriminator}`);
            const gameName = member.game.name;

            username = await resolveAlias(username, env);
            const knownName = await getKnownUser(username, env);
            if (!knownName) continue;
            username = knownName;

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

export async function sendWeeklySummary(env: Env) {
    const now = new Date();
    const week = getISOWeek(now);
    const year = getYear(now);

    try {
        const stats = await getWeeklyStats(env, week, year);
        if (!stats) return;

        const channelId = env.DISCORD_CHANNEL_ID;
        if (!channelId) return;

        await sendDiscordMessage(env, channelId, {
            content: `**${stats.winnerName} äiä o viikon geimeri, gz!!!**`,
            embeds: [stats.embed]
        });
    } catch (err) {
        console.error('Error sending weekly summary:', err);
    }
}
