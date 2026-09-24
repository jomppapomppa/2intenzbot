import { describe, it, expect, vi, beforeEach } from 'vitest';
import { updateLiigaScores } from './scheduled';
import { handleLiigaComponent } from './interaction';
import * as logic from './logic';

describe('Liiga scheduled and interaction timing', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('sends notification starting 2 hours before earliest game', async () => {
        const earliestStartIso = '2026-09-24T18:30:00.000Z'; // 18:30 UTC
        const mockGames = [
            {
                id: 101,
                start: earliestStartIso,
                homeTeam: { teamName: 'Tappara', goals: 0, goalEvents: [] },
                awayTeam: { teamName: 'Ilves', goals: 0, goalEvents: [] },
                started: false,
                ended: false,
                gameTime: 0,
                currentPeriod: 1,
                finishedType: 'NOT_STARTED'
            }
        ];

        vi.spyOn(logic, 'fetchLiigaGames').mockResolvedValue(mockGames as any);
        vi.spyOn(logic, 'syncMatchesToDb').mockResolvedValue();
        vi.spyOn(logic, 'getDailyBets').mockResolvedValue([]);
        vi.spyOn(logic, 'formatDiscordEmbed').mockReturnValue({ title: 'Liiga' } as any);

        const kvStore = new Map<string, any>();
        const mockEnv: any = {
            DISCORD_CHANNEL_ID: 'channel-123',
            KV: {
                get: vi.fn(async (key: string) => kvStore.get(key) || null),
                put: vi.fn(async (key: string, val: string) => { kvStore.set(key, JSON.parse(val)); }),
            },
            DB: {}
        };

        globalThis.fetch = vi.fn().mockResolvedValue(
            new Response(JSON.stringify({ id: 'msg-1' }), { status: 200 })
        );

        // System time: 2 hours and 5 minutes before earliest game -> notification should be skipped
        const timeBefore2h = new Date(new Date(earliestStartIso).getTime() - (2 * 60 * 60 * 1000 + 5 * 60 * 1000));
        vi.useFakeTimers();
        vi.setSystemTime(timeBefore2h);

        await updateLiigaScores(mockEnv);
        expect(globalThis.fetch).not.toHaveBeenCalled();

        // System time: 1 hour 55 minutes before earliest game (within 2h window) -> notification sent
        const timeWithin2h = new Date(new Date(earliestStartIso).getTime() - (2 * 60 * 60 * 1000 - 5 * 60 * 1000));
        vi.setSystemTime(timeWithin2h);

        await updateLiigaScores(mockEnv);
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);

        vi.useRealTimers();
    });

    it('rejects bets placed earlier than 2 hours before first game', async () => {
        const earliestStartIso = '2026-09-24T18:30:00.000Z';
        const mockGames = [
            {
                id: 101,
                start: earliestStartIso,
                homeTeam: { teamName: 'Tappara', goals: 0, goalEvents: [] },
                awayTeam: { teamName: 'Ilves', goals: 0, goalEvents: [] },
                started: false,
                ended: false,
                gameTime: 0,
                currentPeriod: 1,
                finishedType: 'NOT_STARTED'
            }
        ];

        vi.spyOn(logic, 'fetchLiigaGames').mockResolvedValue(mockGames as any);

        const mockEnv: any = { DISCORD_CHANNEL_ID: 'channel-123' };

        // 2 hours and 1 minute before game
        const timeTooEarly = new Date(new Date(earliestStartIso).getTime() - (2 * 60 * 60 * 1000 + 60 * 1000));
        vi.useFakeTimers();
        vi.setSystemTime(timeTooEarly);

        const interaction = {
            data: { custom_id: 'liiga:bet' },
            user: { id: 'user-123' }
        };

        const res = await handleLiigaComponent(interaction, mockEnv);
        const data = await res.json() as any;
        expect(data.data.content).toContain('Vetoja voi asettaa 2h – 1min');

        vi.useRealTimers();
    });
});
