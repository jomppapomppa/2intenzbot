import { Command } from '../types';
import { viikongeimeri } from './viikongeimeri';
import { countdown } from './countdown';
import { ketalines } from './ketalines';

export const COMMANDS: Record<string, Command> = {
    viikongeimeri,
    countdown,
    ketalines,
};
