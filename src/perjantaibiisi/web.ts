import { getISOWeek, getYear } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { Env } from '../types';
import { parseYouTubeId } from '../utils';
import { BASE_TEMPLATE } from './template';

export async function handleVotingWebRequest(request: Request, env: Env): Promise<Response | null> {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname.startsWith('/perjantaibiisi-vote')) {
        const parts = url.pathname.split('/');
        const token = parts[parts.indexOf('perjantaibiisi-vote') + 1];
        const tokenData = await env.KV.get(`vote_token:${token}`, { type: 'json' }) as { userId: string, username: string } | null;

        if (!tokenData) {
            return new Response('Virheellinen tai vanhentunut linkki.', { status: 404 });
        }

        const now = toZonedTime(new Date(), 'Europe/Helsinki');
        const week = getISOWeek(now);
        const year = getYear(now);

        const songs = await env.DB.prepare(
            `SELECT * FROM pb_songs WHERE week = ? AND year = ? AND is_next_week = 0`
        ).bind(week, year).all();

        const songData = songs.results.map((s: any) => ({
            ...s,
            youtube_id: parseYouTubeId(s.url)
        }));

        return new Response(renderVotingPage(songData, tokenData, token), {
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
    }

    if (request.method === 'POST' && url.pathname === '/api/perjantaibiisi-vote') {
        const { token, votes } = await request.json() as { token: string, votes: Record<string, number> };
        const tokenData = await env.KV.get(`vote_token:${token}`, { type: 'json' }) as { userId: string, username: string } | null;

        if (!tokenData) return new Response('Unauthorized', { status: 401 });

        const now = toZonedTime(new Date(), 'Europe/Helsinki');
        const week = getISOWeek(now);
        const year = getYear(now);

        if (now.getDay() !== 5 || now.getHours() < 11 || now.getHours() >= 15) {
            return new Response('Äänestysaika on päättynyt.', { status: 403 });
        }

        const songsInWeek = await env.DB.prepare(
            `SELECT COUNT(*) as count FROM pb_songs WHERE week = ? AND year = ? AND is_next_week = 0`
        ).bind(week, year).first<{ count: number }>();
        const maxScore = songsInWeek?.count || 0;

        for (const [songId, relativeScore] of Object.entries(votes)) {
            if (typeof relativeScore !== 'number' || relativeScore < 0 || relativeScore >= maxScore) {
                return new Response('Virheellinen pistemäärä', { status: 400 });
            }

            await env.DB.prepare(
                `INSERT OR REPLACE INTO pb_votes (song_id, voter_id, voter_name, score, week, year)
                 VALUES (?, ?, ?, ?, ?, ?)`
            ).bind(songId, tokenData.userId, tokenData.username, relativeScore, week, year).run();
        }

        return new Response('OK');
    }

    return null;
}

export function renderVotingPage(songs: any[], user: { username: string, userId: string }, token: string) {
    const songListHtml = songs.map((song, index) => `
        <div class="song-card" id="song-${song.id}">
            <div class="song-info">
                <h3>${song.title}</h3>
                <p class="proposer">Ehdottaja: ${song.proposer_name} - ${new Date(song.created_at).toLocaleString('fi-FI')}</p>
            </div>
            <div class="video-container">
                <iframe width="100%" height="100%" src="https://www.youtube.com/embed/${song.youtube_id}" frameborder="0" allowfullscreen></iframe>
            </div>
        </div>
    `).join('');

    const voteButtonsHtml = `
        <button class="vote-btn" data-score="0">-</button>
        ${songs.map((_, i) => `
            <button class="vote-btn" data-score="${i + 1}">${i + 1}</button>
        `).join('')}
    `;

    const votingControlsHtml = songs.map((song) => `
        <div class="vote-row" data-song-id="${song.id}">
            <span class="song-title-mini">${song.title}</span>
            <div class="btn-group">
                ${voteButtonsHtml}
            </div>
        </div>
    `).join('');

    const today = toZonedTime(new Date(), 'Europe/Helsinki');
    const dateStr = today.toLocaleDateString('fi-FI');

    const content = `
        <header>
            <h1>Perjantaibiisi ${dateStr}</h1>
            <p class="user-greeting">Kuuntele kappaleet ja valitse lopuksi jokaiselle kappaleelle pistemäärä.</p>
        </header>

        <div class="song-list">
            ${songListHtml}
        </div>

        <div class="voting-section">
            <h2>Äänestä</h2>
            <p style="font-size: 0.8rem; color: var(--text-muted); margin: 1rem 0 2rem;">
                Valitse jokaiselle kappaleelle pistemäärä. Suurempi numero on parempi. Samaa numeroa voi käyttää vain kerran.
            </p>
            <div id="voting-controls">
                ${votingControlsHtml}
            </div>
            <button id="submit-votes" disabled>Tallenna</button>
            <div id="status" class="status-msg"></div>
        </div>

        <script>
            const songs = ${JSON.stringify(songs)};
            const token = "${token}";
            const storageKey = \`pb_votes_rel_\${token}\`;
            let selections = {};
            let hasUnsavedChanges = false;

            window.addEventListener('beforeunload', (e) => {
                if (hasUnsavedChanges) {
                    e.preventDefault();
                    e.returnValue = '';
                }
            });

            // Load from localStorage using relative "max-n" logic
            try {
                const saved = localStorage.getItem(storageKey);
                if (saved) {
                    const offsets = JSON.parse(saved);
                    const currentMax = songs.length;
                    
                    songs.forEach(s => {
                        if (offsets[s.id] !== undefined) {
                            const score = currentMax - offsets[s.id];
                            selections[s.id] = score;
                        }
                    });
                }
            } catch (e) { console.error("Failed to load votes", e); }

            updateButtons();

            document.querySelectorAll('.vote-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const row = e.target.closest('.vote-row');
                    const songId = row.dataset.songId;
                    const score = parseInt(e.target.dataset.score);

                    if (selections[songId] === score) {
                        delete selections[songId];
                    } else {
                        if (score !== 0) {
                            for (const id in selections) {
                                if (selections[id] === score) {
                                    delete selections[id];
                                }
                            }
                        }
                        selections[songId] = score;
                    }
                    saveToStorage();
                    hasUnsavedChanges = true;
                    updateButtons();
                });
            });

            function saveToStorage() {
                const currentMax = songs.length;
                const offsets = {};
                Object.entries(selections).forEach(([id, score]) => {
                    offsets[id] = currentMax - score;
                });
                localStorage.setItem(storageKey, JSON.stringify(offsets));
            }

            function updateButtons() {
                document.querySelectorAll('.vote-row').forEach(row => {
                    const songId = row.dataset.songId;
                    const currentScore = selections[songId];

                    row.querySelectorAll('.vote-btn').forEach(btn => {
                        const btnScore = parseInt(btn.dataset.score);
                        btn.classList.remove('selected');
                        if (btnScore === currentScore) {
                            btn.classList.add('selected');
                        }
                    });
                });

                const submitBtn = document.getElementById('submit-votes');
                submitBtn.disabled = Object.keys(selections).length < songs.length;

                const status = document.getElementById('status');
                if (hasUnsavedChanges) {
                    status.textContent = "Tallentamattomia muutoksia";
                    status.style.color = "var(--text-muted)";
                } else if (status.textContent === "Tallentamattomia muutoksia") {
                    status.textContent = "";
                }
            }

            document.getElementById('submit-votes').addEventListener('click', async () => {
                const status = document.getElementById('status');
                status.textContent = "Tallennetaan...";
                const votesToSave = {};
                const currentMax = songs.length;

                for (const [id, score] of Object.entries(selections)) {
                    if (score !== 0) {
                        votesToSave[id] = currentMax - score;
                    }
                }

                try {
                    const response = await fetch('/api/perjantaibiisi-vote', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ token, votes: votesToSave })
                    });
                    if (response.ok) {
                        hasUnsavedChanges = false;
                        status.textContent = "Äänet tallennettu onnistuneesti!";
                        status.style.color = "#4ade80";
                    } else {
                        status.textContent = "Virhe tallennettaessa: " + (await response.text());
                        status.style.color = "#f87171";
                    }
                } catch (err) {
                    status.textContent = "Verkkovirhe.";
                    status.style.color = "#f87171";
                }
            });
        </script>
    `;

    return BASE_TEMPLATE(`Perjantaibiisi ${dateStr} - Äänestys`, content);
}
