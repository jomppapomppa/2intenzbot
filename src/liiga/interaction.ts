import { InteractionResponseType } from 'discord-interactions';
import { Env } from '../types';
import { jsonResponse } from '../utils';
import { fetchLiigaGames, getDailyBets, saveUserBets, deleteUserBets, formatDiscordEmbed, LiigaGame, getHelsinkiDateStr } from './logic';
import { editDiscordMessage } from '../utils/discord';

export async function handleLiigaComponent(interaction: any, env: Env): Promise<Response> {
    const customId = interaction.data.custom_id;
    const now = new Date();
    const dateStr = getHelsinkiDateStr(now);
    const userId = interaction.member?.user?.id || interaction.user?.id;

    if (customId === 'liiga:bet' || customId.startsWith('liiga:bet_page:')) {
        const games = await fetchLiigaGames(env, dateStr);
        if (!games || games.length === 0) {
            return jsonResponse({
                type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                data: { content: 'Ei otteluita tänään.', flags: 64 }
            });
        }

        const startTimes = games.map(g => new Date(g.start).getTime());
        const earliestStart = Math.min(...startTimes);

        const bettingStartTime = earliestStart - 60 * 60 * 1000;
        const bettingEndTime = earliestStart - 1 * 60 * 1000;
        const nowTs = now.getTime();

        if (nowTs < bettingStartTime || nowTs >= bettingEndTime) {
            return jsonResponse({
                type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                data: {
                    content: 'Vetoja voi asettaa 1h – 1min ennen päivän ensimmäisen ottelun alkua.',
                    flags: 64
                }
            });
        }

        const dailyBets = await getDailyBets(env, dateStr);
        const userBets = dailyBets.filter(b => b.userId === userId);
        const userBetMap: Record<number, string> = {};
        for (const b of userBets) {
            userBetMap[b.gameId] = b.prediction;
        }

        // If games count > 5 and user clicked main "Betsaa" button -> show page selector
        if (games.length > 5 && customId === 'liiga:bet') {
            const totalPages = Math.ceil(games.length / 5);
            const pageButtons = [];

            for (let p = 1; p <= totalPages; p++) {
                const startNum = (p - 1) * 5 + 1;
                const endNum = Math.min(p * 5, games.length);
                pageButtons.push({
                    type: 2, // BUTTON
                    style: 1, // PRIMARY
                    label: `Pelit ${startNum}–${endNum}`,
                    custom_id: `liiga:bet_page:${p}`
                });
            }

            return jsonResponse({
                type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                data: {
                    content: `Tänään on ${games.length} ottelua. Valitse tarkasteltava sivu:`,
                    components: [
                        {
                            type: 1, // ACTION_ROW
                            components: pageButtons
                        }
                    ],
                    flags: 64
                }
            });
        }

        // Determine requested page (default 1)
        let page = 1;
        if (customId.startsWith('liiga:bet_page:')) {
            page = parseInt(customId.split(':')[2] || '1');
        }

        const modalGames = games.slice((page - 1) * 5, page * 5);

        const components = modalGames.map(game => {
            const currentPred = userBetMap[game.id];
            const hasSelection = currentPred === '1' || currentPred === 'X' || currentPred === '2';
            return {
                type: 1, // ACTION_ROW
                components: [
                    {
                        type: 3, // STRING_SELECT
                        custom_id: `game_${game.id}`,
                        placeholder: `${game.homeTeam.teamName} - ${game.awayTeam.teamName}`,
                        min_values: 1,
                        max_values: 1,
                        options: [
                            { label: '-', value: '-', default: !hasSelection },
                            { label: '1', value: '1', default: currentPred === '1' },
                            { label: 'X', value: 'X', default: currentPred === 'X' },
                            { label: '2', value: '2', default: currentPred === '2' }
                        ]
                    }
                ]
            };
        });

        return jsonResponse({
            type: 9, // MODAL
            data: {
                custom_id: `liiga:bet_submit:${page}`,
                title: 'Betsaus',
                components: components
            }
        });
    }

    return jsonResponse({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: { content: 'Tuntematon komponentti.', flags: 64 }
    });
}

export async function handleLiigaModalSubmit(interaction: any, env: Env): Promise<Response> {
    try {
        const now = new Date();
        const dateStr = getHelsinkiDateStr(now);
        const userId = interaction.member?.user?.id || interaction.user?.id;
        const userName = interaction.member?.user?.username || interaction.user?.username || 'Tuntematon';

        const customId = interaction.data?.custom_id || '';
        const page = parseInt(customId.split(':')[2] || '1');

        const games = await fetchLiigaGames(env, dateStr);
        const pageGames = games.slice((page - 1) * 5, page * 5);
        const pageGameIds = pageGames.map(g => g.id);

        const predictions: Record<number, '1' | 'X' | '2'> = {};
        const rows = interaction.data?.components || [];

        for (const row of rows) {
            const comp = row.components?.[0];
            if (comp && comp.custom_id?.startsWith('game_')) {
                const gameId = parseInt(comp.custom_id.replace('game_', ''));
                const val = comp.values?.[0];
                if (val === '1' || val === 'X' || val === '2') {
                    predictions[gameId] = val;
                }
            }
        }

        await saveUserBets(env, userId, userName, dateStr, predictions, pageGameIds);

        // Update embed message
        const state = await env.KV.get<any>(`liiga_state_${dateStr}`, { type: 'json' });
        if (state?.messageId) {
            const updatedBets = await getDailyBets(env, dateStr);
            const embedData = formatDiscordEmbed(games, updatedBets);
            await editDiscordMessage(env, env.DISCORD_CHANNEL_ID, state.messageId, { embeds: [embedData] });
        }

        return jsonResponse({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
                content: 'Betsit tallennettu!',
                flags: 64
            }
        });
    } catch (err) {
        console.error('[Liiga] Modal submit error:', err);
        return jsonResponse({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: { content: 'Virhe tallennettaessa betsejä.', flags: 64 }
        });
    }
}
