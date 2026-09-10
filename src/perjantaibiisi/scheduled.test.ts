import { describe, expect, it, vi, beforeEach } from 'vitest';
import { startPerjantaibiisiVoting } from './scheduled';

globalThis.fetch = vi.fn();

describe('startPerjantaibiisiVoting', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('generates voting tokens and sends DMs to song proposers when voting starts', async () => {
        const mockKvStore = new Map<string, string>();
        const mockEnv: any = {
            PERJANTAIBIISI_CHANNEL_ID: 'channel-123',
            PERJANTAIBIISI_VOTE_URL: 'https://jucabot.dev/perjantaibiisi-vote',
            DISCORD_TOKEN: 'test-token',
            KV: {
                get: vi.fn(async (key: string) => mockKvStore.get(key) || null),
                put: vi.fn(async (key: string, value: string) => mockKvStore.set(key, value)),
            },
            DB: {
                prepare: vi.fn((query: string) => {
                    if (query.includes('COUNT(*)')) {
                        return {
                            bind: () => ({
                                first: async () => ({ count: 2 })
                            })
                        };
                    }
                    if (query.includes('DISTINCT proposer_id')) {
                        return {
                            bind: () => ({
                                all: async () => ({
                                    results: [
                                        { proposer_id: 'user1', proposer_name: 'Alice' },
                                        { proposer_id: 'user2', proposer_name: 'Bob' }
                                    ]
                                })
                            })
                        };
                    }
                    return { bind: () => ({ all: async () => ({ results: [] }), first: async () => null }) };
                })
            }
        };

        // Mock fetch for Discord API calls (channel message, open DM 1, send DM 1, open DM 2, send DM 2)
        const fetchMock = vi.fn()
            // Main channel message
            .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'msg-999' }), { status: 200 }))
            // DM channel for user1
            .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'dm-user1' }), { status: 200 }))
            // DM message to user1
            .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'dm-msg-1' }), { status: 200 }))
            // DM channel for user2
            .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'dm-user2' }), { status: 200 }))
            // DM message to user2
            .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'dm-msg-2' }), { status: 200 }));

        globalThis.fetch = fetchMock;

        await startPerjantaibiisiVoting(mockEnv, 'Äänestys alkaa!', 'Peruttu!');

        // Check that KV received vote tokens for both users
        const kvKeys = Array.from(mockKvStore.keys());
        const voteTokenKeys = kvKeys.filter(k => k.startsWith('vote_token:'));
        expect(voteTokenKeys.length).toBe(2);

        // Verify fetch was called for channel message and 2 DMs (2 calls per DM = 4 calls + 1 channel msg = 5 total)
        expect(fetchMock).toHaveBeenCalledTimes(5);

        // Check DM channel creations
        expect(fetchMock).toHaveBeenCalledWith(
            'https://discord.com/api/v10/users/@me/channels',
            expect.objectContaining({
                method: 'POST',
                body: JSON.stringify({ recipient_id: 'user1' })
            })
        );
        expect(fetchMock).toHaveBeenCalledWith(
            'https://discord.com/api/v10/users/@me/channels',
            expect.objectContaining({
                method: 'POST',
                body: JSON.stringify({ recipient_id: 'user2' })
            })
        );
    });
});
