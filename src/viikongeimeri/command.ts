import { InteractionResponseType } from 'discord-interactions';
import { getISOWeek, getYear } from 'date-fns';
import { Command, Env } from '../types';
import { normalizeUsername, jsonResponse, isKnownUser } from '../utils';
import { getWeeklyStats } from './logic';

export const viikongeimeri: Command = {
    data: {
        name: 'viikongeimeri',
        description: 'Näyttää viikon kovimmat geimerit ja pelitunnit.',
        options: [
            {
                name: 'week',
                description: 'Viikkonumero',
                type: 4, // INTEGER
                required: false,
            },
            {
                name: 'year',
                description: 'Vuosi',
                type: 4, // INTEGER
                required: false,
            },
        ],
    },
    async execute(interaction: any, env: Env): Promise<Response> {
        const options = interaction.data.options || [];
        const now = new Date();
        const currentWeek = getISOWeek(now);
        const currentYear = getYear(now);

        const week = options.find((o: any) => o.name === 'week')?.value || currentWeek;
        const year = options.find((o: any) => o.name === 'year')?.value || currentYear;

        // Restriction: Only known users can use this command
        const callerName = normalizeUsername(interaction.member?.user?.username || interaction.user?.username || 'Tuntematon');
        if (!(await isKnownUser(callerName, env))) {
            return jsonResponse({
                type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                data: {
                    content: 'Et ole tunnettujen pelaajien listalla. Pyydä ylläpitäjää lisäämään sinut.',
                    flags: 64
                }
            });
        }

        console.log(`[Command] Executing viikongeimeri for week ${week}/${year}`);

        try {
            const stats = await getWeeklyStats(env, week, year);

            if (!stats) {
                return jsonResponse({
                    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                    data: { content: `Ei pelidataa viikolle ${week}/${year}.` }
                });
            }

            return jsonResponse({
                type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                data: {
                    embeds: [stats.embed]
                }
            });
        } catch (err) {
            console.error('Error fetching stats:', err);
            return jsonResponse({
                type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                data: { content: "Virhe haettaessa tilastoja." }
            });
        }
    }
};
