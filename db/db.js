import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config();

const dbPath = process.env.SQLITE_PATH || './data.sqlite';
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

export function run(sql, params=[]) {
  const stmt = db.prepare(sql);
  return stmt.run(...params);
}
export function query(sql, params=[]) {
  const stmt = db.prepare(sql);
  return stmt.all(...params);
}
export function get(sql, params=[]) {
  const stmt = db.prepare(sql);
  return stmt.get(...params);
}
export default db;
