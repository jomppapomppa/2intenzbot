import { getISOWeek, getYear } from 'date-fns';
import { toZonedTime, format as formatZoned } from 'date-fns-tz';
import { Env } from '../types';
import {
    sendDiscordMessage,
    editDiscordMessage,
    sendDiscordReply,
    addDiscordReaction,
    getYouTubeMetadata,
    parseYouTubeId
} from '../utils';

export async function pollPerjantaibiisiChannel(env: Env) {
    const channelId = env.PERJANTAIBIISI_CHANNEL_ID;
    if (!channelId) return;

    try {
        const lastPolledId = await env.KV.get('pb_last_message_id');
        const url = new URL(`https://discord.com/api/v10/channels/${channelId}/messages`);
        if (lastPolledId) url.searchParams.set('after', lastPolledId);
        url.searchParams.set('limit', '50');

        const response = await fetch(url.toString(), {
            headers: { 'Authorization': `Bot ${env.DISCORD_TOKEN}` }
        });

        if (!response.ok) return;

        const messages: any[] = await response.json();
        if (messages.length === 0) return;

        // Sort messages from oldest to newest to process in order
        messages.sort((a, b) => a.id.localeCompare(b.id));

        const now = toZonedTime(new Date(), 'Europe/Helsinki');
        const week = getISOWeek(now);
        const year = getYear(now);
        const hour = now.getHours();
        const day = now.getDay();

        // Proposals are accepted until Friday 11:00
        const isVotingPeriod = (day === 5 && hour >= 11 && hour < 15);
        const isAfterVotingFriday = (day === 5 && hour >= 15) || (day > 5);
        // If it's Friday after 11:00, proposals go to NEXT week
        const targetWeek = (isVotingPeriod || isAfterVotingFriday) ? (week + 1) : week;
        const targetYear = (targetWeek > 52 && week === 52) ? year + 1 : year;

        for (const msg of messages) {
            const youtubeId = parseYouTubeId(msg.content);
            if (!youtubeId) {
                continue;
            }
            const songUrl = `https://www.youtube.com/watch?v=${youtubeId}`;

            // Check if already proposed THIS target week
            const existing = await env.DB.prepare(
                `SELECT proposer_name FROM pb_songs WHERE url LIKE ? AND week = ? AND year = ?`
            ).bind(`%${youtubeId}%`, targetWeek, targetYear).first<{ proposer_name: string }>();

            if (existing) {
                await addDiscordReaction(env, channelId, msg.id, '❌');
            } else {
                const meta = await getYouTubeMetadata(songUrl);
                const title = meta?.title || "Tuntematon kappale";

                await env.DB.prepare(
                    `INSERT INTO pb_songs (url, title, proposer_name, proposer_id, week, year, is_next_week)
                        VALUES (?, ?, ?, ?, ?, ?, ?)`
                ).bind(songUrl, title, msg.author.username, msg.author.id, targetWeek, targetYear, (targetWeek > week ? 1 : 0)).run();

                await addDiscordReaction(env, channelId, msg.id, '✅');
            }
        }

        // Update last message ID
        await env.KV.put('pb_last_message_id', messages[messages.length - 1].id);
    } catch (err) {
        console.error('Error polling channel:', err);
    }
}

export async function sendPerjantaibiisiInvite(env: Env) {
    const now = toZonedTime(new Date(), 'Europe/Helsinki');
    // Find next Friday
    let friday = new Date(now);
    friday.setDate(now.getDate() + (5 - now.getDay() + 7) % 7);
    const dateStr = formatZoned(friday, 'd.M.');

    const content = `Ehdota omaa suosikkiasi perjantaibiisiksi lähettämällä YouTube-linkki kanavalle! Voit ehdottaa perjantaibiisiä pe ${dateStr} klo 10.59 asti.`;
    await sendDiscordMessage(env, env.PERJANTAIBIISI_CHANNEL_ID, content);
}

export async function startPerjantaibiisiVoting(env: Env) {
    const now = toZonedTime(new Date(), 'Europe/Helsinki');
    const week = getISOWeek(now);
    const year = getYear(now);

    const songs = await env.DB.prepare(
        `SELECT COUNT(*) as count FROM pb_songs WHERE week = ? AND year = ? AND is_next_week = 0`
    ).bind(week, year).first<{ count: number }>();

    if (!songs || songs.count < 2) {
        await sendDiscordMessage(env, env.PERJANTAIBIISI_CHANNEL_ID, "Tarpeeksi montaa ehdotusta ei saapunut, viikon äänestys on peruttu.");
        return;
    }

    const content = "Äänestys alkaa! Äänestä komennon /perjantaibiisi ohjeilla! Äänestysaika päättyy klo 15:00.";
    const messageId = await sendDiscordMessage(env, env.PERJANTAIBIISI_CHANNEL_ID, content);
    if (messageId) {
        await env.KV.put('pb_voting_message_id', messageId);
    }
}

export async function endPerjantaibiisiVoting(env: Env) {
    const now = toZonedTime(new Date(), 'Europe/Helsinki');
    const week = getISOWeek(now);
    const year = getYear(now);

    // Edit start message
    const startMsgId = await env.KV.get('pb_voting_message_id');
    if (startMsgId) {
        await editDiscordMessage(env, env.PERJANTAIBIISI_CHANNEL_ID, startMsgId, "Äänestysaika on päättynyt.");
    }

    // Calculate winner
    const results = await env.DB.prepare(`
        SELECT s.id, s.title, s.proposer_name, SUM(v.score) as total_score
        FROM pb_songs s
        JOIN pb_votes v ON s.id = v.song_id
        WHERE s.week = ? AND s.year = ? AND s.is_next_week = 0
        GROUP BY s.id
        ORDER BY total_score ASC
    `).bind(week, year).all<{ id: number, title: string, proposer_name: string, total_score: number }>();

    if (!results.results || results.results.length === 0) {
        await sendDiscordMessage(env, env.PERJANTAIBIISI_CHANNEL_ID, "Yhtään ääntä ei ole annettu, voittajaa ei voida julistaa.");
        return;
    }

    const winner = results.results[0];
    const embed = {
        title: `🏆 Perjantaibiisi: ${winner.title}`,
        description: `Ehdottaja: **${winner.proposer_name}**\nPistemäärä: **${winner.total_score}**\n\n**Tulokset:**\n` +
            results.results.map(r => `${r.title} (${r.proposer_name}): ${r.total_score} pistettä`).join('\n'),
        color: 0xffd700
    };

    await sendDiscordMessage(env, env.PERJANTAIBIISI_CHANNEL_ID, {
        embeds: [embed]
    });
}

export async function handlePerjantaibiisiScheduled(env: Env, ctx: ExecutionContext, day: number, hour: number, minute: number) {
    // Every minute: Poll YouTube links
    ctx.waitUntil(pollPerjantaibiisiChannel(env));

    // Perjantaibiisi Flow
    if (day === 1 && hour === 9 && minute === 0) {
        // Monday 09:00: Invite proposals
        ctx.waitUntil(sendPerjantaibiisiInvite(env));
    } else if (day === 5 && hour === 9 && minute === 0) {
        // Friday 09:00: Deadline reminder
        ctx.waitUntil(sendDiscordMessage(env, env.PERJANTAIBIISI_CHANNEL_ID, "Äänestys lähestyy! Voit ehdottaa perjantaibiisiä klo 10.59 asti!"));
    } else if (day === 5 && hour === 11 && minute === 0) {
        // Friday 11:00: Start voting
        ctx.waitUntil(startPerjantaibiisiVoting(env));
    } else if (day === 5 && hour === 14 && minute === 45) {
        // Friday 14:45: 15min left
        ctx.waitUntil(sendDiscordMessage(env, env.PERJANTAIBIISI_CHANNEL_ID, "Äänestysaikaa jäljellä 15min! Äänestä komennon /perjantaibiisi ohjeilla!"));
    } else if (day === 5 && hour === 15 && minute === 0) {
        // Friday 15:00: End voting and announce winner
        ctx.waitUntil(endPerjantaibiisiVoting(env));
    }
}

