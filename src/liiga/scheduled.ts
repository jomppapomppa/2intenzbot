import { Env } from '../types';
import { sendDiscordMessage, editDiscordMessage } from '../utils/discord';
import { LiigaState, fetchLiigaGames, formatDiscordEmbed } from './logic';

// In-memory cache to reduce KV read operations
let memoryStates: Record<string, LiigaState> = {};

export async function updateLiigaScores(env: Env) {
    const now = new Date();
    // Use Finland time (UTC+2)
    const dateStr = now.toISOString().split('T')[0];

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

    // Calculate notification start time (15 min before the earliest game)
    const startTimes = gamesData.map(g => new Date(g.start).getTime());
    const earliestStart = Math.min(...startTimes);
    const notificationStartTime = new Date(earliestStart - 15 * 60 * 1000);

    // Check if we should be polling
    const anyActive = gamesData.some(g => g.started && !g.ended);
    const shouldStartNotify = now >= notificationStartTime && !state?.messageId;

    if (!anyActive && !shouldStartNotify && state?.messageId && state.lastActiveUpdateDone) {
        // All games ended and we already did the final update, or not yet time to notify
        // Update state to ensure we store nextNotificationTime if needed
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

    const embedData = formatDiscordEmbed(gamesData);

    if (!state.messageId && shouldStartNotify) {
        // Send new message
        try {
            const messageId = await sendDiscordMessage(env, env.DISCORD_CHANNEL_ID, { embeds: [embedData] });
            if (messageId) {
                console.log(`[Liiga] Sent new message: ${messageId}`);
                state.messageId = messageId;
            }
        } catch (e) {
            console.error('[Liiga] Failed to send new message', e);
        }
    } else if (state.messageId) {
        // Update existing message if content changed or score changed
        // For simplicity, we update if any game is active or if it's the first time
        console.log(`[Liiga] Updating existing message: ${state.messageId}`);
        try {
            await editDiscordMessage(env, env.DISCORD_CHANNEL_ID, state.messageId, { embeds: [embedData] });
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

    // Track if we've done the final update after games ended
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

    // Update memory cache always
    memoryStates[kvKey] = state;

    // Only update KV if something meaningful changed to save writes
    if (stateChanged) {
        console.log(`[Liiga] State changed, updating KV`);
        await env.KV.put(kvKey, JSON.stringify(state));
    } else {
        console.log(`[Liiga] No changes, skipping KV update`);
    }
}
