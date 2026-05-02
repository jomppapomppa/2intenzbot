import { Env } from '../types';

// Memory cache for optimizations
let memoryCountdown: { targetDate: string; description: string } | null = null;
let lastNickname: string | null = null;
let lastCountdownFetch: number = 0;

export async function updateCountdownStatus(env: Env) {
    const nowTs = Date.now();

    // Only fetch from KV if cache is older than 5 minutes
    if (!memoryCountdown || (nowTs - lastCountdownFetch > 5 * 60 * 1000)) {
        console.log(`[Countdown] Fetching from KV (Cache expired or empty)`);
        memoryCountdown = await env.KV.get('active_countdown', { type: 'json', cacheTtl: 60 });
        lastCountdownFetch = nowTs;
    }

    if (!memoryCountdown) return;

    const now = new Date();
    const targetDate = new Date(memoryCountdown.targetDate);
    const diff = targetDate.getTime() - now.getTime();

    // If more than 24h passed, remove the countdown
    if (diff < -24 * 60 * 60 * 1000) {
        console.log(`[Countdown] Finished and 24h passed. Cleaning up.`);
        await env.KV.delete('active_countdown');
        memoryCountdown = null;
        await updateBotNickname(env, ''); // Reset nickname
        return;
    }

    let nickname = '';
    if (diff > 0) {
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

        const dd = String(days).padStart(2, '0');
        const hh = String(hours).padStart(2, '0');
        const mm = String(minutes).padStart(2, '0');

        nickname = `${dd}:${hh}:${mm} ${memoryCountdown.description}`;
    } else {
        nickname = `00:00:00 ${memoryCountdown.description}`;
    }

    // Discord nickname limit is 32 characters
    if (nickname.length > 32) {
        nickname = nickname.substring(0, 29) + '...';
    }

    // Only update if nickname changed to minimize Discord API writes
    if (nickname !== lastNickname) {
        await updateBotNickname(env, nickname);
        lastNickname = nickname;
    }
}

async function updateBotNickname(env: Env, nickname: string) {
    const GUILD_ID = env.DISCORD_GUILD_ID;
    if (!GUILD_ID) return;

    console.log(`[Countdown] Updating nickname to: ${nickname}`);

    try {
        const response = await fetch(`https://discord.com/api/v10/guilds/${GUILD_ID}/members/@me`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bot ${env.DISCORD_TOKEN}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                nick: nickname
            })
        });

        if (!response.ok) {
            console.error(`[Countdown] Failed to update nickname: ${await response.text()}`);
        }
    } catch (err) {
        console.error(`[Countdown] Error updating nickname:`, err);
    }
}
