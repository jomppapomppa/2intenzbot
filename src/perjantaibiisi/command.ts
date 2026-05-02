import { InteractionResponseType } from 'discord-interactions';
import { toZonedTime } from 'date-fns-tz';
import { Command, Env } from '../types';
import { jsonResponse, normalizeUsername } from '../utils';

export const perjantaibiisi: Command = {
    data: {
        name: 'perjantaibiisi',
        description: 'Luo henkilökohtaisen äänestyslinkin perjantaibiisille.',
    },
    async execute(interaction: any, env: Env): Promise<Response> {
        const now = toZonedTime(new Date(), 'Europe/Helsinki');
        const day = now.getDay(); // 5 is Friday
        const hour = now.getHours();

        // Voting is open on Friday between 11:00 and 15:00
        if (day !== 5 || hour < 11 || hour >= 15) {
            return jsonResponse({
                type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                data: {
                    content: 'Äänestys ei ole juuri nyt käynnissä. Äänestysaika on perjantaisin klo 11.00 - 15.00.',
                    flags: 64
                }
            });
        }

        const user = interaction.member?.user || interaction.user;
        const userId = user.id;
        const username = normalizeUsername(user.username);

        // Generate a random token
        const token = crypto.randomUUID();

        // Store token in KV: vote_token:<token> -> { userId, username }
        // TTL: 6 hours (should cover the voting period)
        await env.KV.put(`vote_token:${token}`, JSON.stringify({ userId, username }), { expirationTtl: 6 * 60 * 60 });

        const voteUrl = `${env.PERJANTAIBIISI_VOTE_URL}/${token}`;

        return jsonResponse({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
                content: `Tässä on henkilökohtainen äänestyslinkkisi: ${voteUrl}\n\nÄänestyssivulla voit antaa pisteitä ehdotetuille kappaleille. Voit muokata ääniäsi äänestysajan päättymiseen asti.`,
                flags: 64 // Ephemeral
            }
        });
    }
};
