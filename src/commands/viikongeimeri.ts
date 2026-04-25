import { InteractionResponseType } from 'discord-interactions';
import { getISOWeek, getYear } from 'date-fns';
import { Command, Env } from '../types';
import { formatDuration, isKnownUser, jsonResponse, normalizeUsername } from './utils';

export async function getWeeklyStats(env: Env, week: number, year: number) {
    // 1. Top 10 gamers (total playtime)
    const topGamers = await env.DB.prepare(
        `SELECT username, SUM(total_minutes) as total 
         FROM playtimes 
         WHERE week = ? AND year = ? 
         GROUP BY username 
         ORDER BY total DESC LIMIT 10`
    ).bind(week, year).all<{ username: string; total: number }>();

    if (!topGamers.results || topGamers.results.length === 0) {
        return null;
    }

    // 2. Playtimes grouped by gamer and game
    const detailedStats = await env.DB.prepare(
        `SELECT username, game_name, SUM(total_minutes) as total 
         FROM playtimes 
         WHERE week = ? AND year = ? 
         GROUP BY username, game_name 
         ORDER BY username, total DESC`
    ).bind(week, year).all<{ username: string; game_name: string; total: number }>();

    // 3. Longest single session per gamer
    const longestSessions = await env.DB.prepare(
        `SELECT username, MAX(total_minutes) as max_session, game_name 
         FROM playtimes 
         WHERE week = ? AND year = ? 
         GROUP BY username`
    ).bind(week, year).all<{ username: string; max_session: number; game_name: string }>();

    // Build the message content
    let description = `### 🏆 Viikon Geimeri (${week}/${year})\n`;

    const labels: string[] = [];
    const dataPoints: number[] = [];

    topGamers.results.forEach((g: { username: string; total: number }, i: number) => {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
        const normalizedName = normalizeUsername(g.username);
        description += `**${medal} ${normalizedName}**: ${formatDuration(g.total)}\n`;

        // Detail games
        const userGames = detailedStats.results.filter((s: { username: string }) => s.username === g.username);
        description += `> ${userGames.map((ug: { game_name: string; total: number }) => `${ug.game_name} (${formatDuration(ug.total)})`).join(', ')}\n`;

        // Longest session
        const longest = longestSessions.results.find((ls: { username: string }) => ls.username === g.username);
        if (longest) {
            description += `> *Pisin sessio: ${formatDuration(longest.max_session)} (${longest.game_name})*\n`;
        }
        description += '\n';

        labels.push(normalizeUsername(g.username));
        dataPoints.push(parseFloat((g.total / 60).toFixed(1)));
    });

    // QuickChart generation
    const chartConfig = {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Pelitunnit (h)',
                data: dataPoints,
                backgroundColor: 'rgba(54, 162, 235, 0.5)',
                borderColor: 'rgb(54, 162, 235)',
                borderWidth: 1
            }]
        },
        options: {
            title: { display: true, text: `Viikon ${week} huiput` }
        }
    };
    const chartUrl = `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(chartConfig))}&bkg=white&w=500&h=300`;

    return {
        winnerName: normalizeUsername(topGamers.results[0].username),
        embed: {
            title: `Geimitilastot - Viikko ${week}, ${year}`,
            description: description,
            image: { url: chartUrl },
            color: 0x00ff00
        }
    };
}

export const viikongeimeri: Command = {
    data: {
        name: 'viikongeimeri',
        description: 'Näyttää viikon kovimmat geimerit ja pelitunnit.',
        options: [
            {
                name: 'week',
                description: 'Viikkonumero',
                type: 4, // INTEGER
                required: false,
            },
            {
                name: 'year',
                description: 'Vuosi',
                type: 4, // INTEGER
                required: false,
            },
        ],
    },
    async execute(interaction: any, env: Env): Promise<Response> {
        const options = interaction.data.options || [];
        const now = new Date();
        const currentWeek = getISOWeek(now);
        const currentYear = getYear(now);

        const week = options.find((o: any) => o.name === 'week')?.value || currentWeek;
        const year = options.find((o: any) => o.name === 'year')?.value || currentYear;

        // Restriction: Only known users can use this command
        const callerName = normalizeUsername(interaction.member?.user?.username || interaction.user?.username || 'Tuntematon');
        if (!(await isKnownUser(callerName, env))) {
            return jsonResponse({
                type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                data: {
                    content: 'Et ole tunnettujen pelaajien listalla. Pyydä ylläpitäjää lisäämään sinut.',
                    flags: 64
                }
            });
        }

        console.log(`[Command] Executing viikongeimeri for week ${week}/${year}`);

        try {
            const stats = await getWeeklyStats(env, week, year);
 
            if (!stats) {
                return jsonResponse({
                    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                    data: { content: `Ei pelidataa viikolle ${week}/${year}.` }
                });
            }
 
            return jsonResponse({
                type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                data: {
                    embeds: [stats.embed]
                }
            });
        } catch (err) {
            console.error('Error fetching stats:', err);
            return jsonResponse({
                type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                data: { content: "Virhe haettaessa tilastoja." }
            });
        }
    }
};
