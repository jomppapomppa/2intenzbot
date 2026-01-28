import { Command } from '../types';
import { viikongeimeri } from './viikongeimeri';
import { countdown } from './countdown';

export const COMMANDS: Record<string, Command> = {
    viikongeimeri,
    countdown,
};
