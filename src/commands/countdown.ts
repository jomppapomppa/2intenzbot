import { InteractionResponseType } from 'discord-interactions';
import { Command, Env } from '../types';
import { jsonResponse } from './utils';

export const countdown: Command = {
    data: {
        name: 'countdown',
        description: 'Aseta uusi countdown.',
        options: [
            {
                name: 'target',
                description: 'Kohdepäivämäärä (esim. 2026-12-24 18:00)',
                type: 3, // STRING
                required: true,
            },
            {
                name: 'description',
                description: 'Kuvaus',
                type: 3, // STRING
                required: true,
            },
        ],
    },
    async execute(interaction: any, env: Env): Promise<Response> {
        const options = interaction.data.options || [];
        const targetStr = options.find((o: any) => o.name === 'target')?.value;
        const description = options.find((o: any) => o.name === 'description')?.value;

        if (!targetStr || !description) {
            return jsonResponse({
                type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                data: { content: "Missing target or description." }
            });
        }

        const targetDate = new Date(targetStr);
        if (isNaN(targetDate.getTime())) {
            return jsonResponse({
                type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                data: { content: "Invalid date format. Use YYYY-MM-DD HH:mm." }
            });
        }

        const countdownData = {
            targetDate: targetDate.toISOString(),
            description: description,
        };

        await env.KV.put('active_countdown', JSON.stringify(countdownData));

        return jsonResponse({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: { content: `Countdown asetettu: **${description}** -> ${targetDate.toLocaleString('fi-FI', { timeZone: 'Europe/Helsinki' })}` }
        });
    }
};
