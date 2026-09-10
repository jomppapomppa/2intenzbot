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

export interface UserBet {
    userId: string;
    userName: string;
    gameId: number;
    prediction: '1' | 'X' | '2';
}

export function get60MinScore(game: LiigaGame): { homeGoals: number; awayGoals: number; result: '1' | 'X' | '2' | null } {
    if (!game.started) {
        return { homeGoals: 0, awayGoals: 0, result: null };
    }

    const homeGoalsEvents = (game.homeTeam.goalEvents || []).filter(e => e.period <= 3 || e.gameTime <= 3600);
    const awayGoalsEvents = (game.awayTeam.goalEvents || []).filter(e => e.period <= 3 || e.gameTime <= 3600);

    const homeGoals = homeGoalsEvents.length;
    const awayGoals = awayGoalsEvents.length;

    let result: '1' | 'X' | '2' | null = null;
    if (homeGoals > awayGoals) result = '1';
    else if (homeGoals === awayGoals) result = 'X';
    else result = '2';

    return { homeGoals, awayGoals, result };
}

export async function syncMatchesToDb(env: Env, games: LiigaGame[], date: string) {
    if (!games || games.length === 0) return;

    for (const g of games) {
        const score60 = get60MinScore(g);
        const finalHomeGoals = g.homeTeam.goals;
        const finalAwayGoals = g.awayTeam.goals;
        const status = g.ended ? 'ENDED' : (g.started ? 'ONGOING' : 'NOT_STARTED');

        try {
            await env.DB.prepare(`
                INSERT INTO liiga_matches (id, date, home, away, home_goals, away_goals, home_goals_60, away_goals_60, bet_result, game_time, status, start_time, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(id) DO UPDATE SET
                    home_goals = excluded.home_goals,
                    away_goals = excluded.away_goals,
                    home_goals_60 = excluded.home_goals_60,
                    away_goals_60 = excluded.away_goals_60,
                    bet_result = excluded.bet_result,
                    game_time = excluded.game_time,
                    status = excluded.status,
                    updated_at = CURRENT_TIMESTAMP
            `).bind(
                g.id,
                date,
                g.homeTeam.teamName,
                g.awayTeam.teamName,
                finalHomeGoals,
                finalAwayGoals,
                score60.homeGoals,
                score60.awayGoals,
                score60.result,
                g.gameTime,
                status,
                g.start
            ).run();
        } catch (err) {
            console.error(`[Liiga] DB match sync error for game ${g.id}:`, err);
        }
    }
}

export async function getDailyBets(env: Env, date: string): Promise<UserBet[]> {
    const kvKey = `liiga_bets_${date}`;
    try {
        const cached = await env.KV.get<UserBet[]>(kvKey, { type: 'json' });
        if (cached) return cached;
    } catch (e) {
        console.error('[Liiga] KV read bets error:', e);
    }

    try {
        const res = await env.DB.prepare(`
            SELECT user_id as userId, username as userName, game_id as gameId, prediction
            FROM liiga_bets
            WHERE date = ?
        `).bind(date).all<UserBet>();

        const bets = res.results || [];
        await env.KV.put(kvKey, JSON.stringify(bets), { expirationTtl: 86400 });
        return bets;
    } catch (err) {
        console.error('[Liiga] DB read bets error:', err);
        return [];
    }
}

export async function saveUserBets(
    env: Env,
    userId: string,
    userName: string,
    date: string,
    bets: Record<number, '1' | 'X' | '2'>,
    pageGameIds?: number[]
) {
    const statements = [];

    if (pageGameIds && pageGameIds.length > 0) {
        for (const gameId of pageGameIds) {
            const pred = bets[gameId];
            if (pred === '1' || pred === 'X' || pred === '2') {
                statements.push(
                    env.DB.prepare(`
                        INSERT INTO liiga_bets (user_id, username, game_id, date, prediction, updated_at)
                        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                        ON CONFLICT(user_id, game_id, date) DO UPDATE SET
                            prediction = excluded.prediction,
                            username = excluded.username,
                            updated_at = CURRENT_TIMESTAMP
                    `).bind(userId, userName, gameId, date, pred)
                );
            } else {
                statements.push(
                    env.DB.prepare(`DELETE FROM liiga_bets WHERE user_id = ? AND date = ? AND game_id = ?`).bind(userId, date, gameId)
                );
            }
        }
    } else {
        statements.push(env.DB.prepare(`DELETE FROM liiga_bets WHERE user_id = ? AND date = ?`).bind(userId, date));
        for (const [gameIdStr, prediction] of Object.entries(bets)) {
            const gameId = parseInt(gameIdStr);
            statements.push(
                env.DB.prepare(`
                    INSERT INTO liiga_bets (user_id, username, game_id, date, prediction, updated_at)
                    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                `).bind(userId, userName, gameId, date, prediction)
            );
        }
    }

    if (statements.length > 0) {
        await env.DB.batch(statements);
    }

    const res = await env.DB.prepare(`
        SELECT user_id as userId, username as userName, game_id as gameId, prediction
        FROM liiga_bets
        WHERE date = ?
    `).bind(date).all<UserBet>();

    const allBets = res.results || [];
    await env.KV.put(`liiga_bets_${date}`, JSON.stringify(allBets), { expirationTtl: 86400 });
}

export async function deleteUserBets(env: Env, userId: string, date: string) {
    await env.DB.prepare(`DELETE FROM liiga_bets WHERE user_id = ? AND date = ?`).bind(userId, date).run();

    const res = await env.DB.prepare(`
        SELECT user_id as userId, username as userName, game_id as gameId, prediction
        FROM liiga_bets
        WHERE date = ?
    `).bind(date).all<UserBet>();

    const allBets = res.results || [];
    await env.KV.put(`liiga_bets_${date}`, JSON.stringify(allBets), { expirationTtl: 86400 });
}

export function formatDiscordEmbed(games: LiigaGame[], bets: UserBet[] = []): any {
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

    if (games.length > 0) {
        const firstGameStarted = games.some(g => g.started);

        const userBetsMap: Record<string, { userName: string; bets: Record<number, string> }> = {};
        for (const b of bets) {
            if (!userBetsMap[b.userId]) {
                userBetsMap[b.userId] = { userName: b.userName, bets: {} };
            }
            userBetsMap[b.userId].bets[b.gameId] = b.prediction;
        }

        const bettorEntries = Object.values(userBetsMap);

        if (bettorEntries.length > 0) {
            let betsaajatLines: string[] = [];

            for (const entry of bettorEntries) {
                if (!firstGameStarted) {
                    const count = Object.keys(entry.bets).length;
                    betsaajatLines.push(`${entry.userName}: -/${count}`);
                } else {
                    let correctCount = 0;
                    let totalCount = 0;

                    for (const game of games) {
                        const userPred = entry.bets[game.id];
                        if (userPred) {
                            totalCount++;
                            if (game.started) {
                                const score60 = get60MinScore(game);
                                if (score60.result && userPred === score60.result) {
                                    correctCount++;
                                }
                            }
                        }
                    }

                    betsaajatLines.push(`${entry.userName}: ${correctCount}/${totalCount}`);
                }
            }

            fields.push({
                name: 'Betsaajat',
                value: betsaajatLines.join('\n'),
                inline: false
            });
        }
    }

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

