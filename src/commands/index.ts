import { Command } from '../types';
import { viikongeimeri } from './viikongeimeri';
import { countdown } from './countdown';
import { ketalines } from './ketalines';
import { perjantaibiisi } from '../perjantaibiisi';

const ALL_COMMANDS: Command[] = [
    viikongeimeri,
    countdown,
    ketalines,
    perjantaibiisi,
];

export const COMMANDS: Record<string, Command> = ALL_COMMANDS.reduce((acc, cmd) => {
    acc[cmd.data.name] = cmd;
    return acc;
}, {} as Record<string, Command>);
