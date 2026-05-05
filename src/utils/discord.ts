import { Env } from '../types';

export interface SendMessageOptions {
    content?: string;
    embeds?: any[];
}

function buildPayload(options: SendMessageOptions | string, extra: any = {}): any {
    const payload: any = { ...extra };
    if (typeof options === 'string') {
        payload.content = options;
    } else {
        if (options.content) payload.content = options.content;
        if (options.embeds) payload.embeds = options.embeds;
    }
    return payload;
}

export async function sendDiscordMessage(env: Env, channelId: string, options: SendMessageOptions | string): Promise<string | null> {
    const payload = buildPayload(options);

    const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
        method: 'POST',
        headers: { 'Authorization': `Bot ${env.DISCORD_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    if (response.ok) {
        const data: any = await response.json();
        return data.id;
    }

    const errorText = await response.text();
    throw new Error(`Discord API error (${response.status}): ${errorText}`);
}

export async function editDiscordMessage(env: Env, channelId: string, messageId: string, options: SendMessageOptions | string) {
    const payload = buildPayload(options);

    const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bot ${env.DISCORD_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Discord API error (${response.status}): ${errorText}`);
    }
}

export async function sendDiscordReply(env: Env, channelId: string, messageId: string, options: SendMessageOptions | string) {
    const payload = buildPayload(options, { message_reference: { message_id: messageId } });

    const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
        method: 'POST',
        headers: { 'Authorization': `Bot ${env.DISCORD_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Discord API error (${response.status}): ${errorText}`);
    }
}

export async function addDiscordReaction(env: Env, channelId: string, messageId: string, emoji: string) {
    const encodedEmoji = encodeURIComponent(emoji);
    const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages/${messageId}/reactions/${encodedEmoji}/@me`, {
        method: 'PUT',
        headers: { 'Authorization': `Bot ${env.DISCORD_TOKEN}` }
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Discord API error (${response.status}): ${errorText}`);
    }
}


import { verifyKey } from 'discord-interactions';

export async function isValidRequestSignature(body: string, signature: string | null, timestamp: string | null, publicKey: string): Promise<boolean> {
    if (!signature || !timestamp) return false;
    return verifyKey(body, signature, timestamp, publicKey);
}

