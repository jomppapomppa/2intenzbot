import { Command } from '../types';
import { viikongeimeri } from './viikongeimeri';
import { countdown } from './countdown';
import { ketalines } from './ketalines';

const ALL_COMMANDS: Command[] = [
    viikongeimeri,
    countdown,
    ketalines,
];

export const COMMANDS: Record<string, Command> = ALL_COMMANDS.reduce((acc, cmd) => {
    acc[cmd.data.name] = cmd;
    return acc;
}, {} as Record<string, Command>);
