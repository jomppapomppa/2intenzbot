import { Env } from './types';

export interface LiigaGame {
    id: number;
    start: string;
    homeTeam: {
        teamName: string;
        goals: number;
        goalEvents: LiigaGoalEvent[];
    };
    awayTeam: {
        teamName: string;
        goals: number;
        goalEvents: LiigaGoalEvent[];
    };
    started: boolean;
    ended: boolean;
    gameTime: number;
    currentPeriod: number;
    finishedType: string;
}

export interface LiigaGoalEvent {
    scorerPlayer?: {
        firstName: string;
        lastName: string;
    };
    homeTeamScore: number;
    awayTeamScore: number;
    period: number;
    gameTime: number;
    goalTypes: string[];
}

interface LiigaState {
    messageId: string | null;
    lastChecked: string;
    games: Record<number, {
        lastGoalCount: number;
        status: string;
    }>;
    noGamesToday?: boolean;
    nextNotificationTime?: string;
    lastActiveUpdateDone?: boolean;
}

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

    const gamesData = await fetchLiigaGames(dateStr);
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
        const sentMessage = await sendDiscordMessage(env, embedData);
        if (sentMessage) {
            console.log(`[Liiga] Sent new message: ${sentMessage.id}`);
            state.messageId = sentMessage.id;
        }
    } else if (state.messageId) {
        // Update existing message if content changed or score changed
        // For simplicity, we update if any game is active or if it's the first time
        console.log(`[Liiga] Updating existing message: ${state.messageId}`);
        await updateDiscordMessage(env, state.messageId, embedData);
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

    // Update both memory and KV
    memoryStates[kvKey] = state;
    await env.KV.put(kvKey, JSON.stringify(state));
}

async function fetchLiigaGames(date: string): Promise<LiigaGame[]> {
    try {
        const url = `https://liiga.fi/api/v2/games?tournament=runkosarja&date=${date}`;
        const response = await fetch(url);
        if (!response.ok) return [];
        const data: any = await response.json();
        return data.games || [];
    } catch (err) {
        console.error('Error fetching Liiga games:', err);
        return [];
    }
}

function formatDiscordEmbed(games: LiigaGame[]): any {
    const fields = games.map(game => {
        const home = game.homeTeam.teamName;
        const away = game.awayTeam.teamName;
        const homeScore = game.homeTeam.goals;
        const awayScore = game.awayTeam.goals;

        let name = `${home} - ${away}`;
        let value = '';

        if (!game.started) {
            const startTime = new Date(game.start).toLocaleTimeString('fi-FI', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Helsinki' });
            value = `klo ${startTime}`;
        } else {
            const timePlayed = formatGameTime(game.gameTime);
            const ongoingStar = !game.ended ? '*' : '';
            name = `${home} ${homeScore} - ${awayScore} ${away} (${timePlayed}${ongoingStar})`;

            const lastGoal = getLastGoal(game);
            if (lastGoal) {
                const lastHomeScore = lastGoal.homeTeamScore;
                const lastAwayScore = lastGoal.awayTeamScore;

                const isHomeGoal = game.homeTeam.goalEvents.some(e => e.gameTime === lastGoal.gameTime && e.scorerPlayer?.lastName === lastGoal.scorerPlayer?.lastName);

                const homeScoreStr = isHomeGoal ? `**${lastHomeScore}**` : `${lastHomeScore}`;
                const awayScoreStr = !isHomeGoal ? `**${lastAwayScore}**` : `${lastAwayScore}`;

                const scorerName = lastGoal.scorerPlayer ?
                    `${lastGoal.scorerPlayer.firstName.charAt(0).toUpperCase()}${lastGoal.scorerPlayer.firstName.slice(1).toLowerCase()} ${lastGoal.scorerPlayer.lastName.charAt(0).toUpperCase()}${lastGoal.scorerPlayer.lastName.slice(1).toLowerCase()}`
                    : 'Tuntematon';

                const goalType = lastGoal.goalTypes.length > 0 ? ` (${lastGoal.goalTypes.join(', ')})` : '';
                const goalTime = formatGameTime(lastGoal.gameTime);
                value += `${homeScoreStr} - ${awayScoreStr} ${goalTime} ${scorerName}${goalType}`;
            }
        }

        return {
            name,
            value,
            inline: false
        };
    });

    return {
        title: "Liiga",
        color: 0x0099ff,
        fields: fields,
        timestamp: new Date().toISOString()
    };
}

function formatGameTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function getLastGoal(game: LiigaGame): LiigaGoalEvent | null {
    const homeGoals = game.homeTeam.goalEvents || [];
    const awayGoals = game.awayTeam.goalEvents || [];
    const allGoals = [...homeGoals, ...awayGoals].sort((a, b) => b.gameTime - a.gameTime);
    return allGoals.length > 0 ? allGoals[0] : null;
}

async function sendDiscordMessage(env: Env, embed: any) {
    const channelId = env.DISCORD_CHANNEL_ID;
    const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
        method: 'POST',
        headers: {
            'Authorization': `Bot ${env.DISCORD_TOKEN}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ embeds: [embed] })
    });
    if (response.ok) return response.json() as Promise<any>;
    return null;
}

async function updateDiscordMessage(env: Env, messageId: string, embed: any) {
    const channelId = env.DISCORD_CHANNEL_ID;
    await fetch(`https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`, {
        method: 'PATCH',
        headers: {
            'Authorization': `Bot ${env.DISCORD_TOKEN}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ embeds: [embed] })
    });
}
