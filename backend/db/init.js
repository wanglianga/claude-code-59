/* 启动初始化：等待数据库 → 执行 schema → 空库时灌入种子数据 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from '../src/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitDb() {
  for (let i = 0; i < 60; i++) {
    try {
      await pool.query('SELECT 1');
      console.log('database is ready');
      return;
    } catch (e) {
      console.log(`waiting for database... (${i + 1}) ${e.message}`);
      await sleep(1500);
    }
  }
  throw new Error('database not ready after retries');
}

async function main() {
  await waitDb();

  const exists = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_name='users'`);
  if (exists.rows.length === 0) {
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await pool.query(schema);
    console.log('schema applied');
  } else {
    console.log('schema already present, skip');
  }

  const { rows } = await pool.query('SELECT count(*)::int AS n FROM users');
  if (rows[0].n === 0) {
    console.log('empty database, seeding...');
    await import('./seed.js');
  } else {
    console.log('data exists, skip seed');
  }
  try { await pool.end(); } catch { /* seed 模块可能已关闭连接池 */ }
}

main().catch((e) => { console.error(e); process.exit(1); });
