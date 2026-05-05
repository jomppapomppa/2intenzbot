import { Env } from '../types';

// In-memory cache to avoid KV reads when the worker instance is reused
const memoryCache = new Set<string>();

export interface ScheduledTaskTime {
    day: number;
    hour: number;
    minute: number;
}

export interface CurrentTime extends ScheduledTaskTime {
    dateStr: string;
}

/**
 * Runs a task exactly once within a specified time window, using KV to track execution.
 * 
 * @param env The environment object (with KV binding)
 * @param taskKey A unique key for this task (e.g. "pb_invite")
 * @param target The target time (day, hour, minute)
 * @param current The current time (day, hour, minute, dateStr)
 * @param callback The async function to execute
 * @param windowMinutes How long after the target time the task is allowed to start (default 5)
 */
export async function runScheduledTask(
    env: Env,
    taskKey: string,
    target: ScheduledTaskTime,
    current: CurrentTime,
    callback: () => Promise<any>,
    windowMinutes: number = 5
) {
    // 1. Check if it's the right day and hour (Cheap local check)
    if (current.day !== target.day || current.hour !== target.hour) {
        return;
    }

    // 2. Check if the minute is within the window [target, target + window]
    if (current.minute < target.minute || current.minute >= target.minute + windowMinutes) {
        return;
    }

    // 3. Check memory cache first (Cheapest check)
    const kvKey = `task_${taskKey}_${current.dateStr}_${target.hour}_${target.minute}`;
    if (memoryCache.has(kvKey)) {
        return;
    }

    // 4. Check KV with cacheTtl (minimum 60s as per Cloudflare limits)
    // This helps if the worker is hit multiple times at the same edge location
    const ttlSeconds = Math.max(60, windowMinutes * 60);
    const alreadyRun = await env.KV.get(kvKey, { cacheTtl: ttlSeconds });
    
    if (alreadyRun) {
        memoryCache.add(kvKey);
        return;
    }

    // 5. Run the task
    console.log(`[Scheduler] Running task: ${taskKey}`);
    try {
        await callback();
        // 6. Mark as done in KV and memory
        // Mark as done in KV with expiration (2 days is enough for unique daily/weekly tasks)
        await env.KV.put(kvKey, 'done', { expirationTtl: 172800 });
        memoryCache.add(kvKey);
    } catch (err) {
        console.error(`[Scheduler] Error running task ${taskKey}:`, err);
    }
}
