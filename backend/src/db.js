import pg from 'pg';

const pool = new pg.Pool({
  host: process.env.DB_HOST || 'db',
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME || 'pethospital',
  user: process.env.DB_USER || 'pet',
  password: process.env.DB_PASSWORD || 'petpass',
  max: 10,
});

export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await fn(client);
    await client.query('COMMIT');
    return r;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export const q = (text, params) => pool.query(text, params);
export default pool;
