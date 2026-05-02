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

// In-memory cache for lineups to reduce KV reads
export const memoryLineups: Record<string, { state: LineupState; lastFetched: number }> = {};

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
