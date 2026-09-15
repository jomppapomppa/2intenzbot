import { getISOWeek, getYear } from 'date-fns';
import { toZonedTime, format as formatZoned } from 'date-fns-tz';
import { Env, Day } from '../types';
import {
    sendDiscordMessage,
    sendDiscordDM,
    editDiscordMessage,
    addDiscordReaction,
    getYouTubeMetadata,
    parseYouTubeId,
    runScheduledTask
} from '../utils';
import { createVotingLink } from './utils';

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
        const isAfterVotingFriday = (day === Day.FRIDAY && hour >= 15) || day === Day.SATURDAY || day === Day.SUNDAY;
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

    // Send voting link DMs to users who have submitted songs for this week
    const proposers = await env.DB.prepare(
        `SELECT DISTINCT proposer_id, proposer_name FROM pb_songs WHERE week = ? AND year = ? AND is_next_week = 0 AND proposer_id IS NOT NULL AND proposer_id != ''`
    ).bind(week, year).all<{ proposer_id: string, proposer_name: string }>();

    if (proposers.results && proposers.results.length > 0) {
        for (const proposer of proposers.results) {
            try {
                const voteUrl = await createVotingLink(env, proposer.proposer_id, proposer.proposer_name);
                const dmMessage = `Perjantaibiisin äänestys on alkanut! Tässä on henkilökohtainen äänestyslinkkisi: ${voteUrl}\n\nÄänestyssivulla voit antaa pisteitä ehdotetuille kappaleille. Voit muokata ääniäsi äänestysajan päättymiseen asti.`;
                await sendDiscordDM(env, proposer.proposer_id, dmMessage);
            } catch (err) {
                console.error(`Failed to send voting link DM to ${proposer.proposer_name} (${proposer.proposer_id}):`, err);
            }
        }
    }
}

export interface SongStat {
    id: number;
    title: string;
    proposer_name: string;
    createdAt: string;
    total_score: number;
    pointCounts: Record<number, number>;
    earliestVoteTime: string | null;
    voteCount: number;
}

export function compareSongs(a: SongStat, b: SongStat, songCount: number): number {
    // 1. Primary: Total score (descending)
    if (b.total_score !== a.total_score) {
        return b.total_score - a.total_score;
    }

    // 2. Tie-breaker 1: Breakdown of max points down to 1 point
    for (let pts = songCount; pts >= 1; pts--) {
        const countA = a.pointCounts[pts] || 0;
        const countB = b.pointCounts[pts] || 0;
        if (countB !== countA) {
            return countB - countA;
        }
    }

    // 3. Tie-breaker 2: Earlier vote date (earlier date/timestamp wins)
    const timeA = a.earliestVoteTime
        ? new Date(a.earliestVoteTime).getTime()
        : (a.createdAt ? new Date(a.createdAt).getTime() : 0);
    const timeB = b.earliestVoteTime
        ? new Date(b.earliestVoteTime).getTime()
        : (b.createdAt ? new Date(b.createdAt).getTime() : 0);

    if (timeA !== timeB) {
        return timeA - timeB;
    }

    return 0;
}

export async function endPerjantaibiisiVoting(env: Env, statusContent: string, noVotesContent: string) {
    const now = toZonedTime(new Date(), 'Europe/Helsinki');
    const week = getISOWeek(now);
    const year = getYear(now);

    // Edit start message
    try {
        const startMsgId = await env.KV.get('pb_voting_message_id');
        if (startMsgId) {
            await editDiscordMessage(env, env.PERJANTAIBIISI_CHANNEL_ID, startMsgId, statusContent);
        }
    } catch (err) {
        console.error('Failed to edit voting start message:', err);
    }

    // Get all songs for this week
    const songsRes = await env.DB.prepare(
        `SELECT id, title, proposer_name, created_at FROM pb_songs WHERE week = ? AND year = ? AND is_next_week = 0`
    ).bind(week, year).all<{ id: number; title: string; proposer_name: string; created_at: string }>();

    const songs = songsRes.results || [];
    if (songs.length === 0) {
        await sendDiscordMessage(env, env.PERJANTAIBIISI_CHANNEL_ID, noVotesContent);
        return;
    }

    const songCount = songs.length;

    // Get all votes for this week
    const votesRes = await env.DB.prepare(`
        SELECT v.song_id, v.score, v.created_at
        FROM pb_votes v
        JOIN pb_songs s ON s.id = v.song_id
        WHERE s.week = ? AND s.year = ? AND s.is_next_week = 0
    `).bind(week, year).all<{ song_id: number; score: number; created_at?: string }>();

    const votes = votesRes.results || [];
    if (votes.length === 0) {
        await sendDiscordMessage(env, env.PERJANTAIBIISI_CHANNEL_ID, noVotesContent);
        return;
    }

    const songStats = new Map<number, SongStat>();
    for (const song of songs) {
        songStats.set(song.id, {
            id: song.id,
            title: song.title,
            proposer_name: song.proposer_name,
            createdAt: song.created_at,
            total_score: 0,
            pointCounts: {},
            earliestVoteTime: null,
            voteCount: 0
        });
    }

    for (const v of votes) {
        const stat = songStats.get(v.song_id);
        if (stat) {
            stat.voteCount++;
            const pts = songCount - v.score;
            stat.total_score += pts;
            stat.pointCounts[pts] = (stat.pointCounts[pts] || 0) + 1;

            if (v.created_at) {
                if (!stat.earliestVoteTime || new Date(v.created_at).getTime() < new Date(stat.earliestVoteTime).getTime()) {
                    stat.earliestVoteTime = v.created_at;
                }
            }
        }
    }

    const resolvedResults = Array.from(songStats.values())
        .filter(s => s.voteCount > 0)
        .sort((a, b) => compareSongs(a, b, songCount));

    if (resolvedResults.length === 0) {
        await sendDiscordMessage(env, env.PERJANTAIBIISI_CHANNEL_ID, noVotesContent);
        return;
    }

    const winner = resolvedResults[0];
    const embed = {
        title: `🏆 Perjantaibiisi: ${winner.title}`,
        description: `Ehdottaja: **${winner.proposer_name}**\nPistemäärä: **${winner.total_score}**\n\n**Tulokset:**\n` +
            resolvedResults.map(r => `${r.title} (${r.proposer_name}): ${r.total_score} pistettä`).join('\n'),
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

