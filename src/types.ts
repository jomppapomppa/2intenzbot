export interface Env {
    DB: D1Database;
    DISCORD_APPLICATION_ID: string;
    DISCORD_PUBLIC_KEY: string;
    DISCORD_TOKEN: string;
    DISCORD_GUILD_ID: string;
    DISCORD_CHANNEL_ID: string;
    KV: KVNamespace;
    PERJANTAIBIISI_CHANNEL_ID: string;
    PERJANTAIBIISI_VOTE_URL: string;
}

export interface CommandOption {
    name: string;
    description: string;
    type: number;
    required?: boolean;
    choices?: { name: string; value: string | number }[];
}

export interface CommandData {
    name: string;
    description: string;
    options?: CommandOption[];
}

export interface Command {
    data: CommandData;
    execute: (interaction: any, env: Env) => Promise<Response>;
    handleComponent?: (interaction: any, env: Env) => Promise<Response>;
}

export enum Day {
    SUNDAY = 0,
    MONDAY = 1,
    TUESDAY = 2,
    WEDNESDAY = 3,
    THURSDAY = 4,
    FRIDAY = 5,
    SATURDAY = 6,
}
