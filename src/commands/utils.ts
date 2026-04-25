import { Env } from '../types';

export function normalizeUsername(username: string): string {
    // Remove #0000 or #0 suffixes
    return username.replace(/#(0000|0)$/, '');
}

let knownUsersCache: { users: Set<string>; lastFetched: number } | null = null;

export async function isKnownUser(username: string, env: Env): Promise<boolean> {
    const now = Date.now();
    // Cache for 5 minutes
    if (!knownUsersCache || (now - knownUsersCache.lastFetched > 5 * 60 * 1000)) {
        console.log(`[KnownUsers] Fetching from KV`);
        try {
            const raw = await env.KV.get('KNOWN_USERS');
            const users = new Set(raw ? raw.split(/\s+/).filter(u => u.length > 0) : []);
            knownUsersCache = { users, lastFetched: now };
        } catch (err) {
            console.error(`[KnownUsers] Error fetching from KV:`, err);
            // Fallback to empty set but don't cache forever if it failed
            return false;
        }
    }
    return knownUsersCache.users.has(username);
}

let aliasesCache: { aliases: Map<string, string>; lastFetched: number } | null = null;

export async function resolveAlias(username: string, env: Env): Promise<string> {
    const now = Date.now();
    if (!aliasesCache || (now - aliasesCache.lastFetched > 5 * 60 * 1000)) {
        console.log(`[Aliases] Fetching from KV`);
        try {
            const raw = await env.KV.get('USER_ALIASES');
            const map = new Map<string, string>();
            if (raw) {
                raw.split(/\s+/).forEach(pair => {
                    const [from, to] = pair.split(':');
                    if (from && to) map.set(from, to);
                });
            }
            aliasesCache = { aliases: map, lastFetched: now };
        } catch (err) {
            console.error(`[Aliases] Error fetching from KV:`, err);
            return username;
        }
    }
    return aliasesCache.aliases.get(username) || username;
}

export function formatDuration(minutes: number): string {
    if (minutes < 60) return `${minutes} min`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

export function jsonResponse(data: any): Response {
    return new Response(JSON.stringify(data), {
        headers: { 'Content-Type': 'application/json' },
    });
}
