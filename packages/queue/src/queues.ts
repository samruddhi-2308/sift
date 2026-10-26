import { Queue, type QueueOptions } from 'bullmq';
import { getSharedRedis } from './connection.js';
import type { QueueName } from './types.js';

const queues = new Map<string, Queue>();

export function getQueue<T = unknown>(name: QueueName, opts?: Partial<QueueOptions>): Queue<T> {
  if (queues.has(name)) {
    return queues.get(name) as Queue<T>;
  }

  const queue = new Queue<T>(name, {
    connection: getSharedRedis(),
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000, // 2s, 8s, 30s
      },
      removeOnComplete: {
        count: 1000,
        age: 3600,
      },
      removeOnFail: false,
    },
    ...opts,
  });

  queues.set(name, queue);
  return queue;
}

export async function closeAllQueues(): Promise<void> {
  for (const q of queues.values()) {
    await q.close();
  }
  queues.clear();
}
