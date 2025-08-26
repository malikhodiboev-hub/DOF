
import 'dotenv/config';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const dbPath = process.env.SQLITE_PATH || './data.sqlite';
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
const schema = readFileSync(resolve('db/schema.sqlite.sql'), 'utf8');
db.exec(schema);
console.log('✅ SQLite schema applied at', resolve(dbPath));
