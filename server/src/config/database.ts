import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Get current directory for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from server directory
dotenv.config({ path: join(__dirname, '../../.env') });

// Only log in development
if (process.env.NODE_ENV !== 'production') {
  console.log('🔧 Database Configuration:');
  console.log('Host:', process.env.DB_HOST);
  console.log('User:', process.env.DB_USER);
  console.log('Database:', process.env.DB_NAME);
  console.log('Port:', process.env.DB_PORT);
  console.log('Timezone:', 'IST (+05:30)');
}

/**
 * Database Connection Pool
 * 
 * Configuration can be tuned via environment variables:
 * - DB_POOL_SIZE: Maximum number of connections (default: 10)
 * - DB_MAX_IDLE: Maximum idle connections (default: 5)
 * - DB_CONNECT_TIMEOUT: Connection timeout in ms (default: 10000)
 * - DB_IDLE_TIMEOUT: Idle connection timeout in ms (default: 60000)
 */
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: parseInt(process.env.DB_PORT || '3306'),

  // ✅ CRITICAL: Set timezone to IST (+05:30)
  // This ensures all date operations use IST
  timezone: '+05:30',

  // Connection Pool Settings
  waitForConnections: true,
  connectionLimit: parseInt(process.env.DB_POOL_SIZE || '10'),
  maxIdle: parseInt(process.env.DB_MAX_IDLE || '2'),
  queueLimit: 0,

  // The database is remote, so an idle socket can be dropped by anything on the
  // path — a router, a NAT table, a firewall — without either end being told.
  // The pool then hands out a dead connection and the query fails with
  // PROTOCOL_CONNECTION_LOST. TCP keepalive holds the socket open; the retry
  // wrapper below covers the ones that still slip through.
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,

  connectTimeout: parseInt(process.env.DB_CONNECT_TIMEOUT || '20000'),
  idleTimeout: parseInt(process.env.DB_IDLE_TIMEOUT || '30000'),
});

// ✅ MySQL 8.0 compatibility fix:
// execute() uses the binary (prepared-statement) protocol which is stricter
// in MySQL 8.0 — it rejects LIMIT/OFFSET as strings and arrays in IN clauses.
// query() uses the text protocol and handles all of these correctly.
// Redirecting execute → query fixes all controllers without touching them.
const rawQuery = pool.query.bind(pool);

const TRANSIENT_DB_ERROR_CODES = new Set([
  'ETIMEDOUT',
  'ECONNRESET',
  'EPIPE',
  'PROTOCOL_CONNECTION_LOST',
  'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR',
  'PROTOCOL_ENQUEUE_AFTER_QUIT',
  'ER_CON_COUNT_ERROR', // Too many connections
  'ER_ACCESS_DENIED_ERROR'
]);

let transientRetryCount = 0;
let lastTransientRetryAt: string | null = null;

export function isTransientDbError(error: any): boolean {
  const code = error?.code;
  return typeof code === 'string' && TRANSIENT_DB_ERROR_CODES.has(code);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function executeWithRetry<T = any>(
  sql: string,
  params: any[] = [],
  options?: { retries?: number; baseDelayMs?: number }
): Promise<T> {
  const retries = options?.retries ?? 3;
  const baseDelayMs = options?.baseDelayMs ?? 300;
  const startTime = Date.now();

  for (let attempt = 0; ; attempt++) {
    try {
      // rawQuery, not pool.query — pool.query is itself wrapped in this
      // function below, and calling it here would recurse.
      const result = await rawQuery(sql, params) as T;
      const duration = Date.now() - startTime;

      // Log slow queries (> 2 seconds)
      if (duration > 2000) {
        console.warn(`[DB] ⚠️ Slow Query (${duration}ms): ${sql.substring(0, 100)}...`);
      }

      // Auto-reset stats if DB has been stable for 15 minutes
      if (transientRetryCount > 0 && lastTransientRetryAt) {
        const lastErrorTime = new Date(lastTransientRetryAt).getTime();
        if (Date.now() - lastErrorTime > 15 * 60 * 1000) {
          transientRetryCount = 0;
          lastTransientRetryAt = null;
          console.log('[DB] ℹ️ Connectivity stable. Resetting transient retry stats.');
        }
      }

      return result;
    } catch (error: any) {
      const duration = Date.now() - startTime;
      const shouldRetry = isTransientDbError(error) && attempt < retries;

      console.error(`[DB] ❌ Error on attempt ${attempt + 1} (${duration}ms):`, {
        code: error.code,
        message: error.message,
        sql: sql.substring(0, 100)
      });

      if (!shouldRetry) {
        throw error;
      }

      transientRetryCount += 1;
      lastTransientRetryAt = new Date().toISOString();
      const delayMs = baseDelayMs * Math.pow(2, attempt);
      console.warn(`[DB] 🔄 Transient error "${error.code}". Retrying in ${delayMs}ms...`);
      await sleep(delayMs);
    }
  }
}

/**
 * Route every db.query / db.execute through the retry wrapper.
 *
 * A dropped idle connection surfaces as PROTOCOL_CONNECTION_LOST on whichever
 * query happens to draw it from the pool — the failure has nothing to do with
 * that query, and retrying it on a fresh connection simply works.
 *
 * Doing it here rather than at the call sites is deliberate: there are over 500
 * of them, and a wrapper that has to be remembered is one that will be
 * forgotten. Only the four calls that already wrapped themselves were ever
 * protected, which is why an ordinary page load could fail.
 *
 * Retries are safe for reads, and for the writes here: an INSERT that never
 * reached the server cannot have been applied, and PROTOCOL_CONNECTION_LOST
 * means exactly that. mysql2 raises a different error for a connection lost
 * mid-statement, and that one is not retried.
 */
(pool as any).query = (sql: any, params?: any) => executeWithRetry(sql, params ?? []);
(pool as any).execute = (sql: any, params?: any) => executeWithRetry(sql, params ?? []);

export function getDbRetryStats() {
  return {
    transientRetryCount,
    lastTransientRetryAt
  };
}

export async function pingDatabase(): Promise<boolean> {
  try {
    // rawQuery: a health check should report the state now, not spend three
    // retries and several seconds hiding it.
    await rawQuery('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

// Set IST timezone on every new connection
pool.pool.on('connection', (connection: any) => {
  connection.query("SET time_zone = '+05:30'");
});

/**
 * Get current timestamp in IST (Indian Standard Time) as MySQL datetime string
 * Use this instead of NOW() in SQL queries to ensure correct timezone
 * 
 * @returns string in format 'YYYY-MM-DD HH:MM:SS'
 */
export function getISTTimestamp(): string {
  const now = new Date();
  // IST is UTC+5:30
  const istOffset = 5.5 * 60 * 60 * 1000; // 5.5 hours in milliseconds
  const istTime = new Date(now.getTime() + istOffset);

  const year = istTime.getUTCFullYear();
  const month = String(istTime.getUTCMonth() + 1).padStart(2, '0');
  const day = String(istTime.getUTCDate()).padStart(2, '0');
  const hours = String(istTime.getUTCHours()).padStart(2, '0');
  const minutes = String(istTime.getUTCMinutes()).padStart(2, '0');
  const seconds = String(istTime.getUTCSeconds()).padStart(2, '0');

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * Get current date in IST as MySQL date string
 * 
 * @returns string in format 'YYYY-MM-DD'
 */
export function getISTDate(): string {
  return getISTTimestamp().split(' ')[0];
}

/** A value the driver takes for a `?` placeholder. */
export type SqlValue = string | number | bigint | boolean | Date | Buffer | null;

export default pool;
