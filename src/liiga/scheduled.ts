import { Env } from '../types';
import { sendDiscordMessage, editDiscordMessage } from '../utils/discord';
import { LiigaState, fetchLiigaGames, formatDiscordEmbed, syncMatchesToDb, getDailyBets, getHelsinkiDateStr } from './logic';

// In-memory cache to reduce KV read operations
let memoryStates: Record<string, LiigaState> = {};

export async function updateLiigaScores(env: Env) {
    const now = new Date();
    const dateStr = getHelsinkiDateStr(now);

    const kvKey = `liiga_state_${dateStr}`;
    console.log(`[Liiga] Updating scores for: ${dateStr}`);

    // 1. Check in-memory cache first
    let state: LiigaState | null = memoryStates[kvKey] || null;

    // 2. If not in memory, check KV with cacheTtl
    if (!state) {
        state = await env.KV.get(kvKey, { type: 'json', cacheTtl: 60 });
        if (state) {
            memoryStates[kvKey] = state;
        }
    }

    if (state?.noGamesToday) {
        console.log(`[Liiga] Skipped (No games today marked in cache)`);
        return;
    }

    if (state?.nextNotificationTime && now < new Date(state.nextNotificationTime)) {
        console.log(`[Liiga] Skipped (Not yet time for notification: ${state.nextNotificationTime})`);
        return;
    }

    const gamesData = await fetchLiigaGames(env, dateStr);
    if (!gamesData || gamesData.length === 0) {
        console.log(`[Liiga] No games found in API for ${dateStr}`);
        if (!state) {
            state = {
                messageId: null,
                lastChecked: now.toISOString(),
                games: {},
                noGamesToday: true
            };
        } else {
            state.noGamesToday = true;
            state.lastChecked = now.toISOString();
        }
        await env.KV.put(kvKey, JSON.stringify(state));
        return;
    }

    // Sync matches to DB
    await syncMatchesToDb(env, gamesData, dateStr);

    // Calculate start times
    const startTimes = gamesData.map(g => new Date(g.start).getTime());
    const earliestStart = Math.min(...startTimes);
    // Notification starts 1h before first game when betting opens
    const notificationStartTime = new Date(earliestStart - 60 * 60 * 1000);
    const bettingEndTime = new Date(earliestStart - 1 * 60 * 1000);

    const isBettingOpen = now >= notificationStartTime && now < bettingEndTime;

    // Check if we should be polling
    const anyActive = gamesData.some(g => g.started && !g.ended);
    const shouldStartNotify = now >= notificationStartTime && !state?.messageId;

    if (!anyActive && !shouldStartNotify && state?.messageId && state.lastActiveUpdateDone) {
        if (state) {
            state.nextNotificationTime = notificationStartTime.toISOString();
            await env.KV.put(kvKey, JSON.stringify(state));
        }
        return;
    }

    if (!state) {
        state = {
            messageId: null,
            lastChecked: now.toISOString(),
            games: {}
        };
    }

    const betsData = await getDailyBets(env, dateStr);
    const embedData = formatDiscordEmbed(gamesData, betsData);

    const components = [
        {
            type: 1, // ACTION_ROW
            components: [
                {
                    type: 2, // BUTTON
                    style: 1, // PRIMARY
                    label: 'Betsaa',
                    custom_id: 'liiga:bet',
                    disabled: !isBettingOpen
                }
            ]
        }
    ];

    if (!state.messageId && shouldStartNotify) {
        // Send new message
        try {
            const messageId = await sendDiscordMessage(env, env.DISCORD_CHANNEL_ID, { embeds: [embedData], components });
            if (messageId) {
                console.log(`[Liiga] Sent new message: ${messageId}`);
                state.messageId = messageId;
            }
        } catch (e) {
            console.error('[Liiga] Failed to send new message', e);
        }
    } else if (state.messageId) {
        console.log(`[Liiga] Updating existing message: ${state.messageId}`);
        try {
            await editDiscordMessage(env, env.DISCORD_CHANNEL_ID, state.messageId, { embeds: [embedData], components });
        } catch (e) {
            console.error('[Liiga] Failed to update message', e);
        }
    }

    // Update state
    for (const game of gamesData) {
        state.games[game.id] = {
            lastGoalCount: game.homeTeam.goals + game.awayTeam.goals,
            status: game.finishedType
        };
    }
    state.lastChecked = now.toISOString();
    state.nextNotificationTime = notificationStartTime.toISOString();

    if (anyActive) {
        state.lastActiveUpdateDone = false;
    } else if (state.messageId) {
        state.lastActiveUpdateDone = true;
    }

    const prevState = memoryStates[kvKey];
    const stateChanged = !prevState ||
        prevState.messageId !== state.messageId ||
        prevState.noGamesToday !== state.noGamesToday ||
        prevState.lastActiveUpdateDone !== state.lastActiveUpdateDone ||
        JSON.stringify(prevState.games) !== JSON.stringify(state.games);

    memoryStates[kvKey] = state;

    if (stateChanged) {
        console.log(`[Liiga] State changed, updating KV`);
        await env.KV.put(kvKey, JSON.stringify(state));
    } else {
        console.log(`[Liiga] No changes, skipping KV update`);
    }
}

