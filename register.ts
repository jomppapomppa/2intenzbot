import { COMMANDS } from './src/commands/index';

const BOT_TOKEN = process.argv[2];
const APP_ID = process.argv[3];
const GUILD_ID = process.argv[4];

if (!BOT_TOKEN || !APP_ID) {
    console.log('Usage: npm run register <BOT_TOKEN> <APP_ID> [GUILD_ID]');
    process.exit(1);
}

const url = GUILD_ID
    ? `https://discord.com/api/v10/applications/${APP_ID}/guilds/${GUILD_ID}/commands`
    : `https://discord.com/api/v10/applications/${APP_ID}/commands`;

const commandData = Object.values(COMMANDS).map(cmd => cmd.data);

async function register() {
    console.log(`Registering ${commandData.length} commands...`);

    const response = await fetch(url, {
        method: 'PUT',
        headers: {
            Authorization: `Bot ${BOT_TOKEN}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(commandData),
    });

    if (response.ok) {
        console.log('Successfully registered commands!');
    } else {
        const error = await response.text();
        console.error('Error registering commands:', error);
    }
}

register();
