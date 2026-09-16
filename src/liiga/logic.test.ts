import { describe, it, expect } from 'vitest';
import { formatDiscordEmbed, LiigaGame, UserBet } from './logic';

describe('Liiga formatDiscordEmbed', () => {
    const mockGames: LiigaGame[] = [
        {
            id: 1,
            start: '2026-09-16T18:30:00Z',
            homeTeam: {
                teamName: 'HIFK',
                goals: 3,
                goalEvents: [
                    { homeTeamScore: 1, awayTeamScore: 0, period: 1, gameTime: 600, goalTypes: [] },
                    { homeTeamScore: 2, awayTeamScore: 0, period: 2, gameTime: 1800, goalTypes: [] },
                    { homeTeamScore: 3, awayTeamScore: 1, period: 3, gameTime: 3400, goalTypes: [] }
                ]
            },
            awayTeam: {
                teamName: 'TPS',
                goals: 1,
                goalEvents: [
                    { homeTeamScore: 2, awayTeamScore: 1, period: 2, gameTime: 2000, goalTypes: [] }
                ]
            },
            started: true,
            ended: false,
            gameTime: 3600,
            currentPeriod: 3,
            finishedType: 'REGULAR'
        },
        {
            id: 2,
            start: '2026-09-16T18:30:00Z',
            homeTeam: {
                teamName: 'Kärpät',
                goals: 2,
                goalEvents: [
                    { homeTeamScore: 1, awayTeamScore: 0, period: 1, gameTime: 300, goalTypes: [] },
                    { homeTeamScore: 2, awayTeamScore: 2, period: 3, gameTime: 3500, goalTypes: [] }
                ]
            },
            awayTeam: {
                teamName: 'Tappara',
                goals: 2,
                goalEvents: [
                    { homeTeamScore: 1, awayTeamScore: 1, period: 2, gameTime: 1500, goalTypes: [] },
                    { homeTeamScore: 1, awayTeamScore: 2, period: 3, gameTime: 3000, goalTypes: [] }
                ]
            },
            started: true,
            ended: false,
            gameTime: 3600,
            currentPeriod: 3,
            finishedType: 'REGULAR'
        }
    ];

    const mockBets: UserBet[] = [
        { userId: 'u1', userName: 'Matti', gameId: 1, prediction: '1' },
        { userId: 'u1', userName: 'Matti', gameId: 2, prediction: 'X' },
        { userId: 'u2', userName: 'Pekka', gameId: 1, prediction: '2' }
    ];

    it('formats ongoing games without final result indicators', () => {
        const embed = formatDiscordEmbed(mockGames, mockBets);
        
        expect(embed.fields[0].name).toBe('HIFK 3 - 1 TPS (60:00*)');
        expect(embed.fields[1].name).toBe('Kärpät 2 - 2 Tappara (60:00*)');

        const betsaajatField = embed.fields.find((f: any) => f.name === 'Betsaajat');
        expect(betsaajatField).toBeDefined();
        expect(betsaajatField.value).toContain('Matti: 2/2');
        expect(betsaajatField.value).toContain('Pekka: 0/1');
        expect(betsaajatField.value).not.toContain(' -  ');
    });

    it('formats finished games with final result indicators and bolded correct predictions without separators on final update', () => {
        const finishedGames: LiigaGame[] = mockGames.map(g => ({ ...g, ended: true }));
        const embed = formatDiscordEmbed(finishedGames, mockBets);

        expect(embed.fields[0].name).toBe('HIFK 3 - 1 TPS (60:00) - 1');
        expect(embed.fields[1].name).toBe('Kärpät 2 - 2 Tappara (60:00) - X');

        const betsaajatField = embed.fields.find((f: any) => f.name === 'Betsaajat');
        expect(betsaajatField).toBeDefined();
        expect(betsaajatField.value).toContain('Matti: 2/2 (**1****X**)');
        expect(betsaajatField.value).toContain('Pekka: 0/1 (2-)');
    });
});
