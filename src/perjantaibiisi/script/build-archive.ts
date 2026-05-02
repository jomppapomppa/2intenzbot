import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { startOfISOWeek, endOfISOWeek, setISOWeek, setYear, format } from 'date-fns';
import { fi } from 'date-fns/locale';

// Configuration
const DB_NAME = "2intenzbot";
const OUTPUT_DIR = path.join(__dirname, "../../../output/perjantaibiisi");
const IS_LOCAL = process.argv.includes('--local');

// Utility: Run D1 Query via Wrangler
function queryD1(sql: string): any[] {
    const normalizedSql = sql.replace(/\s+/g, ' ').trim();
    console.log(`[Query] Running (${IS_LOCAL ? 'local' : 'remote'}): ${normalizedSql.substring(0, 60)}...`);
    try {
        const mode = IS_LOCAL ? '--local' : '--remote';
        const cmd = `npx wrangler d1 execute ${DB_NAME} ${mode} --command "${normalizedSql.replace(/"/g, '\\"')}" --json`;
        const output = execSync(cmd).toString();
        const results = JSON.parse(output);
        return results[0].results || [];
    } catch (err: any) {
        console.error(`[Error] Failed to run query: ${normalizedSql}`);
        return [];
    }
}

// Utility: Get date info for week
function getWeekInfo(week: number, year: number) {
    let date = setYear(new Date(), year);
    date = setISOWeek(date, week);
    const start = startOfISOWeek(date);
    const end = endOfISOWeek(date);

    // Friday is day 5 of the week
    const friday = new Date(start);
    friday.setDate(start.getDate() + 4);

    return {
        range: `${format(start, 'd.M.', { locale: fi })} – ${format(end, 'd.M.yyyy', { locale: fi })}`,
        friday: format(friday, 'd.M.yyyy', { locale: fi })
    };
}

import { BASE_TEMPLATE } from '../template';

async function main() {
    console.log("🚀 Building Perjantaibiisi Archive...");
    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    const weeks = queryD1("SELECT DISTINCT week, year FROM pb_songs ORDER BY year DESC, week DESC");

    for (const w of weeks) {
        const { week, year } = w;
        const yearDir = path.join(OUTPUT_DIR, year.toString());
        if (!fs.existsSync(yearDir)) fs.mkdirSync(yearDir, { recursive: true });

        const weekInfo = getWeekInfo(week, year);

        const songCountResult = queryD1(`SELECT COUNT(*) as count FROM pb_songs WHERE week = ${week} AND year = ${year} AND is_next_week = 0`);
        const songCount = songCountResult[0]?.count || 0;

        const results = queryD1(`
            SELECT s.*, SUM(${songCount} - v.score) as total_score
            FROM pb_songs s
            JOIN pb_votes v ON s.id = v.song_id
            WHERE s.week = ${week} AND s.year = ${year} AND s.is_next_week = 0
            GROUP BY s.id
            ORDER BY total_score DESC
        `);

        if (results.length === 0) continue;

        // Fetch individual votes for the summary table
        const voters = queryD1(`SELECT DISTINCT voter_name FROM pb_votes WHERE week = ${week} AND year = ${year} ORDER BY voter_name`);
        const allVotes = queryD1(`SELECT song_id, voter_name, score FROM pb_votes WHERE week = ${week} AND year = ${year}`);

        let tableHtml = `
            <div class="summary-section">
                <table class="summary-table">
                    <thead>
                        <tr>
                            <th>Kappale</th>
                            ${voters.map(v => `<th class="voter-head">${v.voter_name}</th>`).join('')}
                            <th class="total-head">Yht</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        results.forEach((s, i) => {
            const medal = i === 0 ? '🏆 ' : i === 1 ? '🥈 ' : i === 2 ? '🥉 ' : '';
            tableHtml += `<tr><td>${medal}${s.title}</td>`;
            voters.forEach(v => {
                const vote = allVotes.find(av => av.song_id === s.id && av.voter_name === v.voter_name);
                const points = vote ? (songCount - vote.score) : '-';
                tableHtml += `<td class="voter-cell">${points}</td>`;
            });
            tableHtml += `<td class="total-cell">${s.total_score}</td></tr>`;
        });

        tableHtml += `</tbody></table></div>`;

        let songsHtml = '';
        results.forEach((s, i) => {
            const medal = i === 0 ? '🏆 ' : i === 1 ? '🥈 ' : i === 2 ? '🥉 ' : '';
            const youtubeId = s.url.match(/(?:v=|\/embed\/|youtu\.be\/)([^&?#/]+)/)?.[1];
            songsHtml += `
                <div class="song-card">
                    <div class="song-info">
                        <span class="score-badge">${s.total_score} pts</span>
                        <h3>${medal}${s.title}</h3>
                        <p class="proposer">Ehdottaja: ${s.proposer_name}</p>
                    </div>
                    ${youtubeId ? `
                    <div class="video-container">
                        <iframe width="100%" height="100%" src="https://www.youtube.com/embed/${youtubeId}" frameborder="0" allowfullscreen></iframe>
                    </div>` : ''}
                </div>
            `;
        });

        const title = `Perjantaibiisi ${weekInfo.friday}`;
        const content = `
            <a href="../index.html" class="back-link">← Takaisin arkistoon</a>
            <header>
                <h1>${title}</h1>
            </header>
            ${tableHtml}
            <div class="song-list">
                ${songsHtml}
            </div>
        `;

        fs.writeFileSync(path.join(yearDir, `${week}.html`), BASE_TEMPLATE(title, content));
    }

    const yearsMap = new Map<number, any[]>();
    for (const w of weeks) {
        if (!yearsMap.has(w.year)) yearsMap.set(w.year, []);
        yearsMap.get(w.year)!.push(w);
    }

    let indexContent = `<h1>Perjantaibiisi - Arkisto</h1>`;
    for (const [year, yearWeeks] of yearsMap.entries()) {
        indexContent += `<h2>${year}</h2><div class="grid">`;
        for (const w of yearWeeks) {
            const weekInfo = getWeekInfo(w.week, w.year);
            const songCountResult = queryD1(`SELECT COUNT(*) as count FROM pb_songs WHERE week = ${w.week} AND year = ${w.year} AND is_next_week = 0`);
            const songCount = songCountResult[0]?.count || 0;

            const winner = queryD1(`
                SELECT s.title, s.proposer_name, SUM(${songCount} - v.score) as total_score
                FROM pb_songs s
                JOIN pb_votes v ON s.id = v.song_id
                WHERE s.week = ${w.week} AND s.year = ${w.year} AND s.is_next_week = 0
                GROUP BY s.id
                ORDER BY total_score DESC
                LIMIT 1
            `)[0];

            if (!winner) continue;

            indexContent += `
                <a href="${w.year}/${w.week}.html" class="week-link">
                    <div style="font-weight: 800; font-size: 1.2rem; margin-bottom: 1rem;">Perjantaibiisi ${weekInfo.friday}</div>
                    <div style="font-size: 0.85rem; color: var(--text-dim); margin-bottom: .5rem;">${winner.title}</div>
                    <div style="font-size: 0.8rem; color: var(--text-muted);">Ehdottaja: ${winner.proposer_name}</div>
                </a>
            `;
        }
        indexContent += `</div>`;
    }

    fs.writeFileSync(path.join(OUTPUT_DIR, "index.html"), BASE_TEMPLATE("Arkisto", indexContent));
    console.log("✨ Done!");
}

main().catch(console.error);
