import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runScheduledTask } from './scheduler';
import { Env } from '../types';

describe('runScheduledTask', () => {
    let mockEnv: any;
    let mockCallback: any;

    beforeEach(() => {
        vi.clearAllMocks();
        mockCallback = vi.fn().mockResolvedValue(undefined);
        mockEnv = {
            KV: {
                get: vi.fn().mockResolvedValue(null),
                put: vi.fn().mockResolvedValue(undefined),
            }
        };
    });

    const target = { day: 5, hour: 11, minute: 0 };
    const currentBase = { day: 5, hour: 11, minute: 0, dateStr: '2026-05-05' };

    it('runs the task if time is exactly at target and not run before', async () => {
        await runScheduledTask(mockEnv as Env, 'task_exact', target, currentBase, mockCallback);
        
        expect(mockCallback).toHaveBeenCalledTimes(1);
    });

    it('does not run if day does not match', async () => {
        const current = { ...currentBase, day: 1 };
        await runScheduledTask(mockEnv as Env, 'task_day_mismatch', target, current, mockCallback);
        
        expect(mockCallback).not.toHaveBeenCalled();
    });

    it('does not run if hour does not match', async () => {
        const current = { ...currentBase, hour: 10 };
        await runScheduledTask(mockEnv as Env, 'task_hour_mismatch', target, current, mockCallback);
        
        expect(mockCallback).not.toHaveBeenCalled();
    });

    it('runs the task if within window (e.g., 2 minutes late)', async () => {
        const current = { ...currentBase, minute: 2 };
        await runScheduledTask(mockEnv as Env, 'task_window_hit', target, current, mockCallback);
        
        expect(mockCallback).toHaveBeenCalledTimes(1);
    });

    it('does not run if past window (e.g., 10 minutes late)', async () => {
        const current = { ...currentBase, minute: 10 };
        await runScheduledTask(mockEnv as Env, 'task_window_miss', target, current, mockCallback);
        
        expect(mockCallback).not.toHaveBeenCalled();
    });

    it('does not run if already in KV', async () => {
        mockEnv.KV.get.mockResolvedValue('done');
        
        await runScheduledTask(mockEnv as Env, 'task_kv_hit', target, currentBase, mockCallback);
        
        expect(mockCallback).not.toHaveBeenCalled();
    });

    it('does not run twice in same worker instance (memory cache)', async () => {
        // First run
        await runScheduledTask(mockEnv as Env, 'memo_task', target, currentBase, mockCallback);
        expect(mockCallback).toHaveBeenCalledTimes(1);

        // Second run with same key
        mockCallback.mockClear();
        await runScheduledTask(mockEnv as Env, 'memo_task', target, currentBase, mockCallback);
        
        expect(mockCallback).not.toHaveBeenCalled();
    });
});
