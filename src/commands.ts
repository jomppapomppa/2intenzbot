import { InteractionResponseType } from 'discord-interactions';
import { getISOWeek, getYear, startOfISOWeek, endOfISOWeek, format } from 'date-fns';
import { Env } from './types';

export async function handleViikonGeimeri(interaction: any, env: Env): Promise<Response> {
    const options = interaction.data.options || [];
    const now = new Date();
    const currentWeek = getISOWeek(now);
    const currentYear = getYear(now);

    const week = options.find((o: any) => o.name === 'week')?.value || currentWeek;
    const year = options.find((o: any) => o.name === 'year')?.value || currentYear;

    console.log(`[Command] Executing viikongeimeri for week ${week}/${year}`);

    try {
        // 1. Top 10 gamers (total playtime)
        const topGamers = await env.DB.prepare(
            `SELECT username, SUM(total_minutes) as total 
			 FROM playtimes 
			 WHERE week = ? AND year = ? 
			 GROUP BY username 
			 ORDER BY total DESC LIMIT 10`
        ).bind(week, year).all<{ username: string; total: number }>();

        if (!topGamers.results || topGamers.results.length === 0) {
            return jsonResponse({
                type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                data: { content: `Ei pelidataa viikolle ${week}/${year}.` }
            });
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

        topGamers.results.forEach((g, i) => {
            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
            description += `**${medal} ${g.username}**: ${formatDuration(g.total)}\n`;

            // Detail games
            const userGames = detailedStats.results.filter(s => s.username === g.username);
            description += `> ${userGames.map(ug => `${ug.game_name} (${formatDuration(ug.total)})`).join(', ')}\n`;

            // Longest session
            const longest = longestSessions.results.find(ls => ls.username === g.username);
            if (longest) {
                description += `> *Pisin sessio: ${formatDuration(longest.max_session)} (${longest.game_name})*\n`;
            }
            description += '\n';

            labels.push(g.username.split('#')[0]);
            dataPoints.push(g.total);
        });

        // QuickChart generation
        const chartConfig = {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Pelitunnit (min)',
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

        return jsonResponse({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
                embeds: [{
                    title: `Geimitilastot - Viikko ${week}, ${year}`,
                    description: description,
                    image: { url: chartUrl },
                    color: 0x00ff00
                }]
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

export async function handleCountdown(interaction: any, env: Env): Promise<Response> {
    const options = interaction.data.options || [];
    const targetStr = options.find((o: any) => o.name === 'target')?.value;
    const description = options.find((o: any) => o.name === 'description')?.value;

    if (!targetStr || !description) {
        return jsonResponse({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: { content: "Missing target or description." }
        });
    }

    const targetDate = new Date(targetStr);
    if (isNaN(targetDate.getTime())) {
        return jsonResponse({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: { content: "Invalid date format. Use YYYY-MM-DD HH:mm." }
        });
    }

    const countdownData = {
        targetDate: targetDate.toISOString(),
        description: description,
    };

    await env.KV.put('active_countdown', JSON.stringify(countdownData));

    return jsonResponse({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: { content: `Countdown asetettu: **${description}** -> ${targetDate.toLocaleString('fi-FI')}` }
    });
}

function formatDuration(minutes: number): string {
    if (minutes < 60) return `${minutes} min`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

function jsonResponse(data: any): Response {
    return new Response(JSON.stringify(data), {
        headers: { 'Content-Type': 'application/json' },
    });
}
