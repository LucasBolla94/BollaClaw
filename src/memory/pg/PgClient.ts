import { Pool, PoolConfig, QueryResult, QueryResultRow } from 'pg';
import { logger } from '../../utils/logger';

// ============================================================
// PgClient — PostgreSQL Connection Pool (Singleton)
// ============================================================
// Manages a connection pool to PostgreSQL with pgvector.
// Falls back gracefully if PostgreSQL is not available.
// ============================================================

export class PgClient {
  private static instance: PgClient | null = null;
  private pool: Pool | null = null;
  private connected = false;

  private constructor() {}

  static getInstance(): PgClient {
    if (!this.instance) {
      this.instance = new PgClient();
    }
    return this.instance;
  }

  async connect(connectionString: string): Promise<boolean> {
    if (this.connected && this.pool) return true;

    try {
      const poolConfig: PoolConfig = {
        connectionString,
        max: 5,                    // Max pool size (small server)
        idleTimeoutMillis: 30000,  // Close idle connections after 30s
        connectionTimeoutMillis: 5000, // 5s connect timeout
      };

      this.pool = new Pool(poolConfig);

      // Test connection
      const client = await this.pool.connect();
      const result = await client.query('SELECT 1 as ok');
      client.release();

      if (result.rows[0]?.ok === 1) {
        this.connected = true;
        logger.info('[PgClient] Connected to PostgreSQL');

        // Verify pgvector extension
        try {
          await this.query("SELECT 'test'::vector(3) IS NOT NULL as has_pgvector");
          logger.info('[PgClient] pgvector extension verified');
        } catch {
          logger.warn('[PgClient] pgvector extension not available — vector search disabled');
          this.connected = false;
          await this.pool.end();
          this.pool = null;
          return false;
        }

        return true;
      }
    } catch (err) {
      logger.warn(`[PgClient] Failed to connect to PostgreSQL: ${err}`);
      this.pool = null;
      this.connected = false;
    }

    return false;
  }

  isConnected(): boolean {
    return this.connected && this.pool !== null;
  }

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[]
  ): Promise<QueryResult<T>> {
    if (!this.pool) throw new Error('PgClient not connected');
    return this.pool.query<T>(text, params);
  }

  async queryOne<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[]
  ): Promise<T | null> {
    const result = await this.query<T>(text, params);
    return result.rows[0] ?? null;
  }

  async queryAll<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[]
  ): Promise<T[]> {
    const result = await this.query<T>(text, params);
    return result.rows;
  }

  getPool(): Pool | null {
    return this.pool;
  }

  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      this.connected = false;
      logger.info('[PgClient] Connection pool closed');
    }
  }
}
