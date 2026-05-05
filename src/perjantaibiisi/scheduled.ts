import { getISOWeek, getYear } from 'date-fns';
import { toZonedTime, format as formatZoned } from 'date-fns-tz';
import { Env, Day } from '../types';
import {
    sendDiscordMessage,
    editDiscordMessage,
    addDiscordReaction,
    getYouTubeMetadata,
    parseYouTubeId,
    runScheduledTask
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
        const isVotingPeriod = (day === Day.FRIDAY && hour >= 11 && hour < 15);
        const isAfterVotingFriday = (day === Day.FRIDAY && hour >= 15) || (day > Day.FRIDAY);
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

export async function startPerjantaibiisiVoting(env: Env, content: string, cancelledContent: string) {
    const now = toZonedTime(new Date(), 'Europe/Helsinki');
    const week = getISOWeek(now);
    const year = getYear(now);

    const songs = await env.DB.prepare(
        `SELECT COUNT(*) as count FROM pb_songs WHERE week = ? AND year = ? AND is_next_week = 0`
    ).bind(week, year).first<{ count: number }>();

    if (!songs || songs.count < 2) {
        await sendDiscordMessage(env, env.PERJANTAIBIISI_CHANNEL_ID, cancelledContent);
        return;
    }

    const messageId = await sendDiscordMessage(env, env.PERJANTAIBIISI_CHANNEL_ID, content);
    if (messageId) {
        await env.KV.put('pb_voting_message_id', messageId);
    }
}

export async function endPerjantaibiisiVoting(env: Env, statusContent: string, noVotesContent: string) {
    const now = toZonedTime(new Date(), 'Europe/Helsinki');
    const week = getISOWeek(now);
    const year = getYear(now);

    // Edit start message
    const startMsgId = await env.KV.get('pb_voting_message_id');
    if (startMsgId) {
        await editDiscordMessage(env, env.PERJANTAIBIISI_CHANNEL_ID, startMsgId, statusContent);
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
        await sendDiscordMessage(env, env.PERJANTAIBIISI_CHANNEL_ID, noVotesContent);
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

export async function handlePerjantaibiisiScheduled(env: Env, ctx: ExecutionContext, now: Date) {
    // Every minute: Poll YouTube links
    ctx.waitUntil(pollPerjantaibiisiChannel(env));

    const current = {
        day: now.getDay(),
        hour: now.getHours(),
        minute: now.getMinutes(),
        week: getISOWeek(now),
        year: getYear(now),
        dateStr: now.toISOString().split('T')[0]
    };

    // Perjantaibiisi Flow

    // Monday 09:00: Activate weekend proposals
    ctx.waitUntil(runScheduledTask(env, 'pb_activate_proposals', { day: Day.MONDAY, hour: 9, minute: 0 }, current, async () => {
        await env.DB.prepare(
            `UPDATE pb_songs SET is_next_week = 0 WHERE is_next_week = 1 AND week = ? AND year = ?`
        ).bind(current.week, current.year).run();
    }));

    // Monday 09:00: Invite proposals
    const nextFriday = new Date(now);
    nextFriday.setDate(now.getDate() + (Day.FRIDAY - now.getDay() + 7) % 7);
    const fridayStr = formatZoned(nextFriday, 'd.M.');

    // Monday 09:00: Invite proposals
    const inviteText = `Ehdota omaa suosikkiasi perjantaibiisiksi lähettämällä YouTube-linkki kanavalle! Voit ehdottaa perjantaibiisiä pe ${fridayStr} klo 10.59 asti.`;
    ctx.waitUntil(runScheduledTask(env, 'pb_invite', { day: Day.MONDAY, hour: 9, minute: 0 }, current, async () => {
        await sendDiscordMessage(env, env.PERJANTAIBIISI_CHANNEL_ID, inviteText);
    }));

    // Friday 09:00: Deadline reminder
    const deadlineText = "Äänestys lähestyy! Voit ehdottaa perjantaibiisiä klo 10.59 asti!";
    ctx.waitUntil(runScheduledTask(env, 'pb_deadline_reminder', { day: Day.FRIDAY, hour: 9, minute: 0 }, current, async () => {
        await sendDiscordMessage(env, env.PERJANTAIBIISI_CHANNEL_ID, deadlineText);
    }));

    // Friday 11:00: Start voting
    const votingStartText = "Äänestys alkaa! Äänestä komennon /perjantaibiisi ohjeilla! Äänestysaika päättyy klo 15:00.";
    const votingCancelledText = "Tarpeeksi montaa ehdotusta ei saapunut, viikon äänestys on peruttu.";
    ctx.waitUntil(runScheduledTask(env, 'pb_start_voting', { day: Day.FRIDAY, hour: 11, minute: 0 }, current, async () => {
        await startPerjantaibiisiVoting(env, votingStartText, votingCancelledText);
    }));

    // Friday 14:45: 15min left
    const votingReminderText = "Äänestysaikaa jäljellä 15min! Äänestä komennon /perjantaibiisi ohjeilla!";
    ctx.waitUntil(runScheduledTask(env, 'pb_voting_reminder', { day: Day.FRIDAY, hour: 14, minute: 45 }, current, async () => {
        await sendDiscordMessage(env, env.PERJANTAIBIISI_CHANNEL_ID, votingReminderText);
    }));

    // Friday 15:00: End voting and announce winner
    const votingEndStatusText = "Äänestysaika on päättynyt.";
    const noVotesText = "Yhtään ääntä ei ole annettu, voittajaa ei julisteta.";
    ctx.waitUntil(runScheduledTask(env, 'pb_end_voting', { day: Day.FRIDAY, hour: 15, minute: 0 }, current, async () => {
        await endPerjantaibiisiVoting(env, votingEndStatusText, noVotesText);
    }));
}

