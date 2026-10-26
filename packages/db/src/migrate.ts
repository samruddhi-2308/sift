import { connectMongo, closeMongo } from './client.js';
import { createAllIndexes } from './indexes.js';
import { createLogger } from '@sift/core';

const logger = createLogger('db-migrate');

export async function runMigration(): Promise<void> {
  logger.info('Starting MongoDB index migrations...');
  try {
    const { db } = await connectMongo();
    const result = await createAllIndexes(db);

    logger.info(
      {
        createdCount: result.created.length,
        existingCount: result.existing.length,
        created: result.created,
      },
      'Migration completed successfully'
    );
  } catch (error) {
    logger.error({ error }, 'Migration failed');
    throw error;
  } finally {
    await closeMongo();
  }
}

import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Execute if run directly via tsx
const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirectRun) {
  runMigration()
    .then(() => {
      logger.info('Migration finished, exiting');
      process.exit(0);
    })
    .catch((err) => {
      logger.error({ err }, 'Migration exited with error');
      process.exit(1);
    });
}
