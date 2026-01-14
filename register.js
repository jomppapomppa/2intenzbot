const BOT_TOKEN = process.argv[2];
const APP_ID = process.argv[3];
const GUILD_ID = process.argv[4];

if (!BOT_TOKEN || !APP_ID) {
    console.log('Usage: node register.js <BOT_TOKEN> <APP_ID> [GUILD_ID]');
    process.exit(1);
}

const url = GUILD_ID
    ? `https://discord.com/api/v10/applications/${APP_ID}/guilds/${GUILD_ID}/commands`
    : `https://discord.com/api/v10/applications/${APP_ID}/commands`;

const command = {
    name: 'viikongeimeri',
    description: 'Näyttää viikon kovimmat geimerit ja pelitunnit.',
    options: [
        {
            name: 'week',
            description: 'Viikkonumero',
            type: 4, // INTEGER
            required: false,
        },
        {
            name: 'year',
            description: 'Vuosi',
            type: 4, // INTEGER
            required: false,
        },
    ],
};

async function register() {
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            Authorization: `Bot ${BOT_TOKEN}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(command),
    });

    if (response.ok) {
        console.log('Successfully registered command!');
    } else {
        console.error('Error registering command:', await response.text());
    }
}

register();
