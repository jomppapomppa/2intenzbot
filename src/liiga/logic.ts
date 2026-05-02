import { Env } from '../types';

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

export interface LiigaState {
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

let memoryTournament: { data: { tournamentType: string } | null, expires: number } | null = null;

export async function getOngoingTournament(env: Env) {
    const now = Date.now();
    const kvKey = 'liiga_tournament_info';

    // 1. Memory Cache
    if (memoryTournament && now < memoryTournament.expires) {
        return memoryTournament.data;
    }

    // 2. KV Cache
    try {
        const cached = await env.KV.get(kvKey, { type: 'json' }) as any;
        if (cached && now < cached.expires) {
            memoryTournament = cached;
            return cached.data;
        }
    } catch (e) {
        console.error('[Liiga] KV read error:', e);
    }

    // 3. Builder.io Fetch
    const url = 'https://cdn.builder.io/api/v3/query/f11503eeae084753968caac3899a5d78/tournaments?apiKey=f11503eeae084753968caac3899a5d78&fields=data%2Cname%2Cid';
    try {
        const response = await fetch(url);
        if (!response.ok) return null;

        const data: any = await response.json();
        const ongoing = data.tournaments?.find((t: any) =>
            t.name === 'ongoingTournament' &&
            t.data &&
            (t.data.tournamentType === 'runkosarja' || t.data.tournamentType === 'playoffs')
        );

        let resultData = null;
        if (ongoing && ongoing.data) {
            resultData = { tournamentType: ongoing.data.tournamentType };
        }

        const result = {
            data: resultData,
            expires: now + 3600000 // 1 hour cache
        };

        // Update caches
        memoryTournament = result;
        await env.KV.put(kvKey, JSON.stringify(result));

        return resultData;
    } catch (err) {
        console.error('[Liiga] Error fetching ongoing tournament:', err);
        return null;
    }
}

export async function fetchLiigaGames(env: Env, date: string): Promise<LiigaGame[]> {
    try {
        const tournamentInfo = await getOngoingTournament(env);
        if (!tournamentInfo) {
            console.log('[Liiga] No ongoing tournament info found, skipping game fetch');
            return [];
        }

        const { tournamentType } = tournamentInfo;
        const url = `https://liiga.fi/api/v2/games?tournament=${tournamentType}&date=${date}`;
        const response = await fetch(url);
        if (!response.ok) return [];
        const data: any = await response.json();
        return data.games || [];
    } catch (err) {
        console.error('[Liiga] Error fetching Liiga games:', err);
        return [];
    }
}

export function formatDiscordEmbed(games: LiigaGame[]): any {
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
