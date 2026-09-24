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

    it('formats finished games with final result indicators and bolded correct predictions on final update', () => {
        const finishedGames: LiigaGame[] = mockGames.map(g => ({ ...g, ended: true }));
        const embed = formatDiscordEmbed(finishedGames, mockBets);

        expect(embed.fields[0].name).toBe('HIFK 3 - 1 TPS (60:00) - 1');
        expect(embed.fields[1].name).toBe('Kärpät 2 - 2 Tappara (60:00) - X');

        const betsaajatField = embed.fields.find((f: any) => f.name === 'Betsaajat');
        expect(betsaajatField).toBeDefined();
        expect(betsaajatField.value).toContain('Matti: 2/2 (**1** **X**)');
        expect(betsaajatField.value).toContain('Pekka: 0/1 (2 -)');
    });

    it('correctly identifies 60min score as X for games decided in overtime or shootouts', () => {
        const otGame: LiigaGame = {
            id: 3,
            start: '2026-09-23T18:30:00Z',
            homeTeam: { teamName: 'Sport', goals: 0, goalEvents: [] },
            awayTeam: {
                teamName: 'K-Espoo',
                goals: 1,
                goalEvents: [
                    {
                        scorerPlayerId: 0,
                        scorerPlayer: undefined,
                        homeTeamScore: 0,
                        awayTeamScore: 0,
                        period: 1,
                        gameTime: 612,
                        goalTypes: ['VT0']
                    },
                    {
                        scorerPlayerId: 31296980,
                        scorerPlayer: { firstName: 'Jere', lastName: 'Väisänen' },
                        homeTeamScore: 0,
                        awayTeamScore: 1,
                        period: 4,
                        gameTime: 3735,
                        goalTypes: []
                    }
                ]
            },
            started: true,
            ended: true,
            gameTime: 3735,
            currentPeriod: 4,
            finishedType: 'ENDED_DURING_EXTENDED_GAME_TIME',
            periods: [
                { index: 1, homeTeamGoals: 0, awayTeamGoals: 0, category: 'NORMAL' },
                { index: 2, homeTeamGoals: 0, awayTeamGoals: 0, category: 'NORMAL' },
                { index: 3, homeTeamGoals: 0, awayTeamGoals: 0, category: 'NORMAL' },
                { index: 4, homeTeamGoals: 0, awayTeamGoals: 1, category: 'OVERTIME' }
            ]
        };

        const embed = formatDiscordEmbed([otGame], []);
        expect(embed.fields[0].name).toBe('Sport 0 - 1 K-Espoo (62:15) - X');
    });
});
