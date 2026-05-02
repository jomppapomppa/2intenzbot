import { Env } from '../types';

export async function sendDiscordMessage(env: Env, channelId: string, content: string): Promise<string | null> {
    try {
        const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
            method: 'POST',
            headers: { 'Authorization': `Bot ${env.DISCORD_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ content })
        });
        if (response.ok) {
            const data: any = await response.json();
            return data.id;
        }
    } catch (err) {
        console.error('Error sending message:', err);
    }
    return null;
}

export async function editDiscordMessage(env: Env, channelId: string, messageId: string, content: string) {
    await fetch(`https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bot ${env.DISCORD_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content })
    });
}

export async function sendDiscordReply(env: Env, channelId: string, messageId: string, content: string) {
    await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
        method: 'POST',
        headers: { 'Authorization': `Bot ${env.DISCORD_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            content,
            message_reference: { message_id: messageId }
        })
    });
}

import { verifyKey } from 'discord-interactions';

export async function isValidRequestSignature(body: string, signature: string | null, timestamp: string | null, publicKey: string): Promise<boolean> {
    if (!signature || !timestamp) return false;
    return verifyKey(body, signature, timestamp, publicKey);
}

