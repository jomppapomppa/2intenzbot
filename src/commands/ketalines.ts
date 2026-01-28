import { InteractionResponseType, MessageComponentTypes, ButtonStyleTypes } from 'discord-interactions';
import { Command, Env } from '../types';
import { jsonResponse } from './utils';

// In-memory cache for lineups to reduce KV reads
export interface LineupPlayer {
    name: string;
    times: string[];
}

export interface LineupState {
    slug: string;
    message: string;
    playerCount: number;
    players: LineupPlayer[];
    times: string[];
}

const memoryLineups: Record<string, { state: LineupState; lastFetched: number }> = {};

export const ketalines: Command = {
    data: {
        name: 'ketälines',
        description: 'Ketä lines???',
        options: [
            {
                name: 'message',
                description: 'Viesti',
                type: 3, // STRING
                required: false,
            },
            {
                name: 'player_count',
                description: 'Pelaajamäärä (oletus 5)',
                type: 4, // INTEGER
                required: false,
            },
        ],
    },
    async execute(interaction: any, env: Env): Promise<Response> {
        try {
            const options = interaction.data.options || [];
            const message = options.find((o: any) => o.name === 'message')?.value || 'lets game';
            const playerCount = options.find((o: any) => o.name === 'player_count')?.value || 5;

            // Calculate next 30-min intervals
            const now = new Date();
            now.setMinutes(now.getMinutes() + (30 - (now.getMinutes() % 30)));
            now.setSeconds(0);
            now.setMilliseconds(0);

            const times: string[] = [];
            for (let i = 0; i < 3; i++) {
                const t = new Date(now.getTime() + i * 30 * 60 * 1000);
                times.push(t.toLocaleTimeString('fi-FI', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Helsinki' }));
            }

            const slug = crypto.randomUUID().slice(0, 8);
            const state: LineupState = {
                slug,
                message,
                playerCount,
                players: [],
                times,
            };

            const kvKey = `lineup:${slug}`;
            await env.KV.put(kvKey, JSON.stringify(state), { expirationTtl: 86400 }); // 24h

            // Update memory cache
            memoryLineups[kvKey] = { state, lastFetched: Date.now() };

            return jsonResponse({
                type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                data: {
                    embeds: [renderEmbed(state)],
                    components: [
                        {
                            type: MessageComponentTypes.ACTION_ROW,
                            components: [
                                ...times.map((t, i) => ({
                                    type: MessageComponentTypes.BUTTON,
                                    style: ButtonStyleTypes.PRIMARY,
                                    label: t,
                                    custom_id: `ketälines:${slug}:t${i + 1}`,
                                })),
                                {
                                    type: MessageComponentTypes.BUTTON,
                                    style: ButtonStyleTypes.DANGER,
                                    label: 'OUT :(',
                                    custom_id: `ketälines:${slug}:leave`,
                                },
                            ],
                        },
                    ],
                },
            });
        } catch (err) {
            console.error('[Lineup] Error in execute:', err);
            return jsonResponse({
                type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                data: { content: 'Virhe käynnistäessä lineä.', flags: 64 }
            });
        }
    },
    async handleComponent(interaction: any, env: Env): Promise<Response> {
        try {
            const customId = interaction.data.custom_id;
            const [, slug, action] = customId.split(':');
            const kvKey = `lineup:${slug}`;
            const nowTs = Date.now();

            let state: LineupState | null = null;
            const cached = memoryLineups[kvKey];

            // Check memory cache first (TTL 5 mins for memory)
            if (cached && (nowTs - cached.lastFetched < 5 * 60 * 1000)) {
                state = cached.state;
            } else {
                console.log(`[Lineup] Fetching ${kvKey} from KV`);
                const raw = await env.KV.get<LineupState>(kvKey, { type: 'json', cacheTtl: 60 });
                if (raw) {
                    state = raw;
                    memoryLineups[kvKey] = { state, lastFetched: nowTs };
                }
            }

            if (!state) {
                return jsonResponse({
                    type: InteractionResponseType.UPDATE_MESSAGE,
                    data: { content: 'Lineä ei löytynyt, vanhentunut?', components: [] }
                });
            }

            const name = interaction.member?.user?.username || interaction.user?.username || 'Tuntematon';
            const prevStateStr = JSON.stringify(state);

            if (action === 'leave') {
                state.players = state.players.filter((p: LineupPlayer) => p.name !== name);
            } else {
                // Action is t1, t2, or t3
                const timeIdx = parseInt(action.substring(1)) - 1;
                const chosenTime = state.times[timeIdx];

                let player = state.players.find((p: LineupPlayer) => p.name === name);
                if (player) {
                    if (!player.times.includes(chosenTime)) {
                        player.times.push(chosenTime);
                        player.times.sort(); // Keep times in order
                    }
                } else {
                    state.players.push({ name, times: [chosenTime] });
                }
            }

            const newStateStr = JSON.stringify(state);
            if (newStateStr !== prevStateStr) {
                console.log(`[Lineup] State changed, updating KV`);
                await env.KV.put(kvKey, newStateStr, { expirationTtl: 86400 });
                memoryLineups[kvKey] = { state, lastFetched: nowTs };
            } else {
                console.log(`[Lineup] No state change, skipping KV write`);
            }

            return jsonResponse({
                type: InteractionResponseType.UPDATE_MESSAGE,
                data: {
                    embeds: [renderEmbed(state)],
                },
            });
        } catch (err) {
            console.error('[Lineup] Error in handleComponent:', err);
            return jsonResponse({
                type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                data: { content: 'Virhe lineä päivitettäessä.', flags: 64 }
            });
        }
    }
};

export function renderEmbed(state: LineupState) {
    const fields = state.players.map((p: LineupPlayer) => ({
        name: '\u200b',
        value: `**${p.name}** (${p.times.join(', ')})`,
        inline: false,
    }));

    const emptySlots = Math.max(0, state.playerCount - state.players.length);
    for (let i = 0; i < emptySlots; i++) {
        fields.push({
            name: '\u200b',
            value: 'x',
            inline: false,
        });
    }

    return {
        title: state.message,
        fields: fields,
        color: 0x3498db,
    };
}
