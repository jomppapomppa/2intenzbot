/// <reference types="node" />
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { startOfISOWeek, endOfISOWeek, setISOWeek, setYear, format } from 'date-fns';
import { fi } from 'date-fns/locale';
import { BASE_HTML } from '../template';

// Configuration
const DB_NAME = "2intenzbot";
const OUTPUT_DIR = path.join(__dirname, "../../../output/viikongeimeri");
const IS_LOCAL = process.argv.includes('--local');

// Utility: Run D1 Query via Wrangler
function queryD1(sql: string): any[] {
    const normalizedSql = sql.replace(/\s+/g, ' ').trim();
    console.log(`[Query] Running (${IS_LOCAL ? 'local' : 'remote'}): ${normalizedSql.substring(0, 60)}...`);
    try {
        const mode = IS_LOCAL ? '--local' : '--remote';
        const cmd = `npx wrangler d1 execute ${DB_NAME} ${mode} --command "${normalizedSql.replace(/"/g, '\\"')}" --json`;
        const output = execSync(cmd).toString();
        // Wrangler outputs an array of results (one per statement)
        const results = JSON.parse(output);
        return results[0].results || [];
    } catch (err: any) {
        console.error(`[Error] Failed to run query: ${normalizedSql}`);
        if (err.stdout) console.error(`Stdout: ${err.stdout.toString()}`);
        if (err.stderr) console.error(`Stderr: ${err.stderr.toString()}`);
        return [];
    }
}

// Utility: Format duration (min -> H h M min)
function formatDuration(minutes: number): string {
    if (minutes < 60) return `${minutes} min`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

// Utility: Normalize username (remove #0000)
function normalizeName(name: string): string {
    return name.replace(/#(0000|0)$/, '');
}

// Utility: Get date range for week
function getWeekRange(week: number, year: number): { range: string; end: Date } {
    let date = setYear(new Date(), year);
    date = setISOWeek(date, week);
    const start = startOfISOWeek(date);
    const end = endOfISOWeek(date);

    return {
        range: `${format(start, 'd.M.', { locale: fi })} - ${format(end, 'd.M.yyyy', { locale: fi })}`,
        end: end
    };
}

async function main() {
    console.log("🚀 Starting Archive Build...");

    // 0. Ensure directory exists
    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    // 1. Get all unique weeks/years
    const weeksList = queryD1("SELECT DISTINCT week, year FROM playtimes ORDER BY year DESC, week DESC");

    if (weeksList.length === 0) {
        console.log("❌ No data found in database.");
        return;
    }

    const yearsMap = new Map<number, number[]>();
    for (const w of weeksList) {
        if (!yearsMap.has(w.year)) yearsMap.set(w.year, []);
        yearsMap.get(w.year)!.push(w.week);
    }

    // 2. Generate Week Pages
    for (const item of weeksList) {
        const { week, year } = item;
        const yearDir = path.join(OUTPUT_DIR, year.toString());
        if (!fs.existsSync(yearDir)) fs.mkdirSync(yearDir, { recursive: true });

        console.log(`[Process] Week ${week}, ${year}`);

        // Fetch data for this week
        const topGamers = queryD1(`SELECT username, SUM(total_minutes) as total FROM playtimes WHERE week = ${week} AND year = ${year} GROUP BY username ORDER BY total DESC LIMIT 10`);
        const detailedStats = queryD1(`SELECT username, game_name, SUM(total_minutes) as total FROM playtimes WHERE week = ${week} AND year = ${year} GROUP BY username, game_name ORDER BY username, total DESC`);
        const longestSessions = queryD1(`SELECT username, MAX(total_minutes) as max_session, game_name FROM playtimes WHERE week = ${week} AND year = ${year} GROUP BY username`);

        // Fetch ALL play dates for these users to calculate streaks
        const usernames = topGamers.map(g => `'${g.username.replace(/'/g, "''")}'`).join(',');
        const playDates = usernames.length > 0 ? queryD1(`
            SELECT DISTINCT username, game_name, date(start_time) as play_date 
            FROM playtimes 
            WHERE username IN (${usernames}) 
            AND date(start_time) <= date('${getWeekRange(week, year).end.toISOString()}')
            ORDER BY play_date DESC
        `) : [];

        // Helper: Calculate streak for a user/game ending at the week's end
        const getStreak = (user: string, game: string) => {
            const dates = playDates
                .filter(d => d.username === user && d.game_name === game)
                .map(d => new Date(d.play_date).getTime());

            if (dates.length === 0) return 0;

            let streak = 0;
            let currentDay = getWeekRange(week, year).end;
            currentDay.setHours(0, 0, 0, 0);

            // Check backwards from the end of the week
            let targetTime = currentDay.getTime();

            // If they didn't play on the last day of the week, check if they played 
            // at all during the week. If not, streak is 0.
            // Actually, let's find the LATEST date they played and check if it's in this week.
            const latestInWeek = dates.find(d => d <= targetTime && d >= targetTime - (7 * 24 * 60 * 60 * 1000));
            if (!latestInWeek) return 0;

            let checkTime = latestInWeek;
            streak = 1;

            while (true) {
                const dayBefore = checkTime - (24 * 60 * 60 * 1000);
                if (dates.includes(dayBefore)) {
                    streak++;
                    checkTime = dayBefore;
                } else {
                    break;
                }
            }
            return streak >= 2 ? streak : 0;
        };

        // Build Leaderboard HTML
        let leaderboardHtml = '<div class="leaderboard">';
        const chartLabels: string[] = [];
        const chartData: number[] = [];

        topGamers.forEach((g, i) => {
            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
            const isWinner = i === 0;
            const normalizedName = normalizeName(g.username);
            const userGames = detailedStats.filter(s => s.username === g.username);
            const longest = longestSessions.find(ls => ls.username === g.username);

            chartLabels.push(normalizedName);
            chartData.push(parseFloat((g.total / 60).toFixed(1)));

            leaderboardHtml += `
                <div class="player-entry ${isWinner ? 'winner' : ''}">
                    <div class="player-row">
                        <div class="player-info">
                            <div class="rank">${medal}</div>
                            <div class="player-name">${normalizedName}</div>
                        </div>
                        <div class="player-time">${formatDuration(g.total)}</div>
                    </div>
                    <ul class="games-list">
                        ${userGames.map(ug => {
                const streak = getStreak(ug.username, ug.game_name);
                return `<li>${ug.game_name} (${formatDuration(ug.total)})${streak > 0 ? `, streak x${streak}` : ''}</li>`;
            }).join('')}
                    </ul>
                    ${longest ? `<div class="session-info">Pisin sessio: ${formatDuration(longest.max_session)} (${longest.game_name})</div>` : ''}
                </div>
            `;
        });
        leaderboardHtml += '</div>';

        const weekTitle = `Viikko ${week}, ${year}`;
        const weekContent = `
            <nav>
                <a href="../index.html" class="back-link">← Takaisin arkistoon</a>
            </nav>
            <h1>${weekTitle}</h1>
            <p style="color: var(--text-dim); margin-top: -20px; margin-bottom: 30px; font-weight: 600;">
                ${getWeekRange(week, year).range}
            </p>
            <div class="card">
                <div class="chart-container">
                    <canvas id="playtimeChart"></canvas>
                </div>
            </div>

            <div class="card">
                <h2>🏆 Viikon Geimerit</h2>
                ${leaderboardHtml}
            </div>

            <script>
                const ctx = document.getElementById('playtimeChart').getContext('2d');
                new Chart(ctx, {
                    type: 'bar',
                    data: {
                        labels: ${JSON.stringify(chartLabels)},
                        datasets: [{
                            label: 'Pelitunnit (h)',
                            data: ${JSON.stringify(chartData)},
                            backgroundColor: 'rgba(52, 152, 219, 0.5)',
                            borderColor: '#3498db',
                            borderWidth: 1
                        }]
                    },
                    options: {
                        indexAxis: 'y',
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: { legend: { display: false } },
                        scales: {
                            x: { grid: { color: '#2d333b' }, ticks: { color: '#9ba1a6' } },
                            y: { grid: { display: false }, ticks: { color: '#e1e4e8', font: { weight: '600' } } }
                        }
                    }
                });
            </script>
        `;

        fs.writeFileSync(path.join(yearDir, `${week}.html`), BASE_HTML(weekTitle, weekContent));
    }

    // 3. Generate Index Page
    let indexContent = `
        <h1>Viikon Geimeri - Arkisto</h1>
        <p style="color: var(--text-dim); margin-bottom: 40px;">Kaikki viikoittaiset pelitunnit kerättynä yhteen paikkaan.</p>
    `;

    for (const [year, weeks] of yearsMap.entries()) {
        indexContent += `
            <section style="margin-bottom: 50px;">
                <h2 style="border-bottom: 2px solid var(--accent); display: inline-block; padding-bottom: 8px; margin-bottom: 20px;">${year}</h2>
                <div class="grid">
        `;

        for (const week of weeks) {
            const top3 = queryD1(`SELECT username, SUM(total_minutes) as total FROM playtimes WHERE week = ${week} AND year = ${year} GROUP BY username ORDER BY total DESC LIMIT 3`);
            const podium = top3.map((g, i) => {
                const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '';
                return `
                    <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                        <span>${medal} ${normalizeName(g.username)}</span>
                        <span style="font-family: monospace; opacity: 0.7;">${formatDuration(g.total)}</span>
                    </div>
                `;
            }).join('');

            indexContent += `
                <a href="${year}/${week}.html" class="week-link">
                    <div style="font-weight: 800; font-size: 1.2rem; margin-bottom: 4px;">Viikko ${week}</div>
                    <div style="font-size: 0.8rem; color: var(--text-dim); margin-bottom: 12px; font-weight: 600;">
                        ${getWeekRange(week, year).range}
                    </div>
                    <div style="font-size: 0.85rem; color: var(--text-dim); margin-bottom: 15px; border-top: 1px solid #2d333b; padding-top: 12px;">
                        ${podium}
                    </div>
                    <span>Katso tilastot →</span>
                </a>
            `;
        }

        indexContent += `
                </div>
            </section>
        `;
    }

    fs.writeFileSync(path.join(OUTPUT_DIR, "index.html"), BASE_HTML("Arkisto", indexContent));

    console.log(`\n✨ Build Complete! Files generated in: ${OUTPUT_DIR}`);
}

main().catch(console.error);
