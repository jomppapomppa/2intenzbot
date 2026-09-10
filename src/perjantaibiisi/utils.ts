import { Env } from '../types';

export async function createVotingLink(env: Env, userId: string, username: string): Promise<string> {
    const token = crypto.randomUUID();
    await env.KV.put(`vote_token:${token}`, JSON.stringify({ userId, username }), { expirationTtl: 6 * 60 * 60 });
    return `${env.PERJANTAIBIISI_VOTE_URL}/${token}`;
}
