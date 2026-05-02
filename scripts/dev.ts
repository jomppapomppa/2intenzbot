/// <reference types="node" />
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// 1. Read .dev.vars for Discord credentials
const envPath = path.join(__dirname, '../.dev.vars');
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    envContent.split('\n').forEach(line => {
        const [key, ...values] = line.split('=');
        if (key && values.length > 0) {
            process.env[key.trim()] = values.join('=').trim().replace(/^["'](.*)["']$/, '$1');
        }
    });
}

const BOT_TOKEN = process.env.DISCORD_TOKEN;
const APP_ID = process.env.DISCORD_APP_ID;
const TUNNEL_URL = process.env.DISCORD_TUNNEL_URL;
const TUNNEL_NAME = process.env.DISCORD_TUNNEL_NAME;

if (!BOT_TOKEN || !APP_ID) {
    console.error('❌ Missing DISCORD_TOKEN or DISCORD_APP_ID in .dev.vars file!');
    process.exit(1);
}

if (!TUNNEL_URL || !TUNNEL_NAME) {
    console.error('❌ Missing DISCORD_TUNNEL_URL or DISCORD_TUNNEL_NAME in .dev.vars file! See the setup guide.');
    process.exit(1);
}

console.log('🚀 Starting local development environment...');

// 2. Start Wrangler
const wrangler = spawn('npx', ['wrangler', 'dev'], { stdio: 'inherit', shell: true });

// 3. Start cloudflared named tunnel
console.log(`🚇 Starting Cloudflare named tunnel (${TUNNEL_NAME})...`);
const tunnel = spawn('npx', ['cloudflared', 'tunnel', '--url', 'http://localhost:8787', 'run', TUNNEL_NAME], { shell: true });

tunnel.stdout.on('data', (data) => {
    process.stdout.write(`[cloudflared] ${data.toString()}`);
});
tunnel.stderr.on('data', (data) => {
    process.stdout.write(`[cloudflared log] ${data.toString()}`);
});

tunnel.on('error', (err) => {
    console.error('❌ Failed to start cloudflared.', err);
});

// 4. Update Discord webhook
console.log(`\n🔗 Tunnel configured at: ${TUNNEL_URL}`);
console.log('🔄 Updating Discord webhook...');

setTimeout(async () => {
    try {
        const response = await fetch(`https://discord.com/api/v10/applications/${APP_ID}`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bot ${BOT_TOKEN}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                interactions_endpoint_url: TUNNEL_URL
            })
        });

        if (response.ok) {
            console.log(`✅ Successfully updated Discord interactions endpoint to: ${TUNNEL_URL}\n`);
        } else {
            const errorText = await response.text();
            console.error(`❌ Failed to update Discord webhook. Discord API responded with: ${errorText}\n`);
        }
    } catch (err) {
        console.error('❌ Failed to update Discord webhook:', err);
    }
}, 3000); // Give wrangler and the tunnel a moment to start before pinging Discord

// Cleanup on exit
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down...');
    wrangler.kill();
    tunnel.kill();
    process.exit();
});
