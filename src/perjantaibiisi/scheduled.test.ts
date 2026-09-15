import { describe, expect, it, vi, beforeEach } from 'vitest';
import { startPerjantaibiisiVoting, pollPerjantaibiisiChannel, compareSongs, SongStat } from './scheduled';
import { getISOWeek, getYear } from 'date-fns';

globalThis.fetch = vi.fn();

describe('compareSongs tie-breaking logic', () => {
    it('sorts higher total_score first', () => {
        const songA: SongStat = {
            id: 1, title: 'Song A', proposer_name: 'User A', createdAt: '2026-09-01T12:00:00Z',
            total_score: 10, pointCounts: { 4: 2, 2: 1 }, earliestVoteTime: '2026-09-01T12:10:00Z', voteCount: 3
        };
        const songB: SongStat = {
            id: 2, title: 'Song B', proposer_name: 'User B', createdAt: '2026-09-01T12:00:00Z',
            total_score: 12, pointCounts: { 4: 3 }, earliestVoteTime: '2026-09-01T12:15:00Z', voteCount: 3
        };

        const sorted = [songA, songB].sort((a, b) => compareSongs(a, b, 4));
        expect(sorted[0].id).toBe(2);
    });

    it('breaks ties using highest individual point breakdown (1st place votes, then 2nd, etc.)', () => {
        // Both have 10 total points
        // Song A has two 4-pt votes and one 2-pt vote
        // Song B has one 4-pt vote and two 3-pt votes
        const songA: SongStat = {
            id: 1, title: 'Song A', proposer_name: 'User A', createdAt: '2026-09-01T12:00:00Z',
            total_score: 10, pointCounts: { 4: 2, 2: 1 }, earliestVoteTime: '2026-09-01T12:10:00Z', voteCount: 3
        };
        const songB: SongStat = {
            id: 2, title: 'Song B', proposer_name: 'User B', createdAt: '2026-09-01T12:00:00Z',
            total_score: 10, pointCounts: { 4: 1, 3: 2 }, earliestVoteTime: '2026-09-01T12:05:00Z', voteCount: 3
        };

        const sorted = [songB, songA].sort((a, b) => compareSongs(a, b, 4));
        // Song A has two 4-pt votes vs Song B's one 4-pt vote -> Song A wins
        expect(sorted[0].id).toBe(1);
    });

    it('breaks ties using earlier vote timestamp when point breakdowns are identical', () => {
        // Both have identical total score (10) and identical point counts
        const songA: SongStat = {
            id: 1, title: 'Song A', proposer_name: 'User A', createdAt: '2026-09-01T12:00:00Z',
            total_score: 10, pointCounts: { 4: 1, 3: 2 }, earliestVoteTime: '2026-09-01T12:10:00Z', voteCount: 3
        };
        const songB: SongStat = {
            id: 2, title: 'Song B', proposer_name: 'User B', createdAt: '2026-09-01T12:00:00Z',
            total_score: 10, pointCounts: { 4: 1, 3: 2 }, earliestVoteTime: '2026-09-01T12:05:00Z', voteCount: 3
        };

        const sorted = [songA, songB].sort((a, b) => compareSongs(a, b, 4));
        // Song B received its vote earlier (12:05 vs 12:10) -> Song B wins
        expect(sorted[0].id).toBe(2);
    });
});

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

describe('pollPerjantaibiisiChannel', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it('assigns Sunday proposals to next week (targetWeek = week + 1, is_next_week = 1)', async () => {
        // Set system time to Sunday 06/09/2026 22:46 Finnish time (19:46 UTC)
        const mockSunday = new Date('2026-09-06T19:46:00Z');
        vi.useFakeTimers();
        vi.setSystemTime(mockSunday);

        const currentIsoWeek = getISOWeek(mockSunday);
        const currentYear = getYear(mockSunday);

        let insertedRow: any = null;

        const mockEnv: any = {
            PERJANTAIBIISI_CHANNEL_ID: 'channel-123',
            DISCORD_TOKEN: 'test-token',
            KV: {
                get: vi.fn(async () => null),
                put: vi.fn(async () => {}),
            },
            DB: {
                prepare: vi.fn((query: string) => {
                    if (query.includes('SELECT proposer_name')) {
                        return { bind: () => ({ first: async () => null }) };
                    }
                    if (query.includes('INSERT INTO pb_songs')) {
                        return {
                            bind: (...args: any[]) => ({
                                run: async () => {
                                    insertedRow = {
                                        url: args[0],
                                        title: args[1],
                                        proposer_name: args[2],
                                        proposer_id: args[3],
                                        week: args[4],
                                        year: args[5],
                                        is_next_week: args[6],
                                    };
                                }
                            })
                        };
                    }
                    return { bind: () => ({ first: async () => null, run: async () => {} }) };
                })
            }
        };

        const mockMessages = [
            {
                id: '10001',
                content: 'https://youtu.be/CDjrkyU-Rw4',
                author: { id: 'user-onanoya', username: 'ONANOYA' }
            }
        ];

        globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
            if (url.includes('/messages')) {
                return new Response(JSON.stringify(mockMessages), { status: 200 });
            }
            if (url.includes('youtube.com/oembed')) {
                return new Response(JSON.stringify({ title: 'Test Song Title' }), { status: 200 });
            }
            if (url.includes('/reactions/')) {
                return new Response(null, { status: 204 });
            }
            return new Response('Not found', { status: 404 });
        });

        await pollPerjantaibiisiChannel(mockEnv);

        expect(insertedRow).not.toBeNull();
        expect(insertedRow.week).toBe(currentIsoWeek + 1);
        expect(insertedRow.is_next_week).toBe(1);

        vi.useRealTimers();
    });
});
