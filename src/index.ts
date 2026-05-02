import { InteractionType, InteractionResponseType } from 'discord-interactions';
import { toZonedTime, format as formatZoned } from 'date-fns-tz';
import { COMMANDS } from './commands';
import { Env } from './types';
import { updateLiigaScores } from './liiga';
import {
    isValidRequestSignature,
} from './utils';
import {
    handleVotingWebRequest,
    handlePerjantaibiisiScheduled
} from './perjantaibiisi';
import {
    trackPlaytimes,
    sendWeeklySummary
} from './viikongeimeri';

import { updateCountdownStatus } from './countdown';
export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        const webResponse = await handleVotingWebRequest(request, env);
        if (webResponse) return webResponse;

        if (request.method === 'POST') {
            const signature = request.headers.get('x-signature-ed25519');
            const timestamp = request.headers.get('x-signature-timestamp');
            const body = await request.text();
            console.log(`[Interaction] Received interaction request`);

            const isValidRequest = await isValidRequestSignature(body, signature, timestamp, env.DISCORD_PUBLIC_KEY);
            if (!isValidRequest) {
                return new Response('Bad request signature', { status: 401 });
            }

            const interaction = JSON.parse(body);

            if (interaction.type === InteractionType.PING) {
                console.log(`[Interaction] Responding to PING`);
                return new Response(JSON.stringify({ type: InteractionResponseType.PONG }), {
                    headers: { 'Content-Type': 'application/json' },
                });
            }

            if (interaction.type === InteractionType.APPLICATION_COMMAND) {
                const { name } = interaction.data;
                console.log(`[Interaction] Command received: ${name}`);
                const command = COMMANDS[name];
                if (command) {
                    try {
                        return await command.execute(interaction, env);
                    } catch (err) {
                        console.error(`[Interaction] Error executing command ${name}:`, err);
                        return new Response(JSON.stringify({
                            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                            data: { content: 'Virhe komentoa suorittaessa.', flags: 64 }
                        }), { headers: { 'Content-Type': 'application/json' } });
                    }
                } else {
                    console.warn(`[Interaction] Unknown command: ${name}`);
                    return new Response(JSON.stringify({
                        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                        data: { content: `Tuntematon komento: ${name}`, flags: 64 }
                    }), { headers: { 'Content-Type': 'application/json' } });
                }
            }

            if (interaction.type === InteractionType.MESSAGE_COMPONENT) {
                const customId = interaction.data.custom_id;
                const commandName = customId.split(':')[0];
                console.log(`[Interaction] Component received for command: ${commandName}`);

                const command = COMMANDS[commandName];
                if (command && command.handleComponent) {
                    try {
                        return await command.handleComponent(interaction, env);
                    } catch (err) {
                        console.error(`[Interaction] Error handling component for ${commandName}:`, err);
                        return new Response(JSON.stringify({
                            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                            data: { content: 'Virhe komponenttia käsiteltäessä.', flags: 64 }
                        }), { headers: { 'Content-Type': 'application/json' } });
                    }
                } else {
                    console.warn(`[Interaction] Unknown component command: ${commandName}`);
                    return new Response(JSON.stringify({
                        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                        data: { content: 'Virhe: Komentoa ei löytynyt komponentille.', flags: 64 }
                    }), { headers: { 'Content-Type': 'application/json' } });
                }
            }
        }

        return new Response('Not Found', { status: 404 });
    },

    async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
        const nowZoned = toZonedTime(new Date(), 'Europe/Helsinki');
        const day = nowZoned.getDay(); // 0 is Sunday, 5 is Friday
        const hour = nowZoned.getHours();
        const minute = nowZoned.getMinutes();

        console.log(`[Scheduled] Job started. Time (FI): ${formatZoned(nowZoned, 'yyyy-MM-dd HH:mm:ss')}`);

        // Every minute: Track playtimes
        ctx.waitUntil(trackPlaytimes(env));

        // Perjantaibiisi scheduling
        ctx.waitUntil(handlePerjantaibiisiScheduled(env, ctx, day, hour, minute));

        // Sunday 20:55: Weekly Summary (Geimeri)
        if (event.cron === "55 20 * * SUN") {
            ctx.waitUntil(sendWeeklySummary(env));
        }

        // Liiga tracking logic
        ctx.waitUntil(updateLiigaScores(env));

        // Countdown tracking logic
        ctx.waitUntil(updateCountdownStatus(env));
    },
};
