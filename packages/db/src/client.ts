import { MongoClient, type Db } from 'mongodb';
export type { Db, MongoClient };
import { config, createLogger } from '@sift/core';

const logger = createLogger('db-client');

let client: MongoClient | null = null;
let db: Db | null = null;

export interface MongoHealthStatus {
  ok: boolean;
  pingMs: number;
  database: string;
  error?: string;
}

export async function connectMongo(
  uri?: string,
  dbName?: string
): Promise<{ client: MongoClient; db: Db }> {
  if (client && db) {
    return { client, db };
  }

  const connectionUri = uri || config.MONGODB_URI;
  const targetDbName = dbName || config.MONGODB_DB_NAME;

  logger.info({ uri: connectionUri, db: targetDbName }, 'Connecting to MongoDB...');

  client = new MongoClient(connectionUri, {
    maxPoolSize: 50,
    minPoolSize: 5,
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 10000,
  });

  await client.connect();
  db = client.db(targetDbName);

  logger.info({ db: targetDbName }, 'Connected to MongoDB successfully');
  return { client, db };
}

export async function getDb(): Promise<Db> {
  if (!db) {
    const conn = await connectMongo();
    return conn.db;
  }
  return db;
}

export async function getMongoClient(): Promise<MongoClient> {
  if (!client) {
    const conn = await connectMongo();
    return conn.client;
  }
  return client;
}

export async function closeMongo(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
    logger.info('MongoDB connection closed');
  }
}

export async function pingMongo(): Promise<MongoHealthStatus> {
  const start = Date.now();
  try {
    const database = await getDb();
    await database.command({ ping: 1 });
    const pingMs = Date.now() - start;
    return {
      ok: true,
      pingMs,
      database: database.databaseName,
    };
  } catch (error) {
    const pingMs = Date.now() - start;
    return {
      ok: false,
      pingMs,
      database: config.MONGODB_DB_NAME,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
