// db/run-sql.mjs — применяет PRAGMA вне транзакции
import fs from 'fs';
import Database from 'better-sqlite3';

const [,, dbPath, sqlPath] = process.argv;
if (!dbPath || !sqlPath) { console.error('Usage: node db/run-sql.mjs <db_file> <sql_file>'); process.exit(2); }
if (!fs.existsSync(dbPath)) { fs.writeFileSync(dbPath, ''); } // создадим пустую БД, если нет
if (!fs.existsSync(sqlPath)) { console.error('SQL not found:', sqlPath); process.exit(4); }

const db = new Database(dbPath);
const raw = fs.readFileSync(sqlPath, 'utf8');

// вытащим PRAGMA, выполним их отдельно
const pragmas = [];
const restLines = [];
for (const line of raw.split(/\r?\n/)) {
  if (/^\s*PRAGMA\s+/i.test(line)) pragmas.push(line.trim().replace(/;+\s*$/, ''));
  else restLines.push(line);
}
for (const p of pragmas) {
  try {
    if (/journal_mode\s*=/i.test(p)) {
      const mode = p.split('=').pop().trim();
      db.pragma(`journal_mode = ${mode}`);
    } else if (/synchronous\s*=/i.test(p)) {
      const mode = p.split('=').pop().trim();
      db.pragma(`synchronous = ${mode}`);
    } else if (/foreign_keys\s*=/i.test(p)) {
      const v = p.split('=').pop().trim();
      db.pragma(`foreign_keys = ${v}`);
    } else {
      db.pragma(p.replace(/^PRAGMA\s+/i,''));
    }
  } catch (e) { console.error('PRAGMA failed:', p, e.message); }
}

// остальной SQL под транзакцией
const rest = restLines.join('\n');
db.exec('BEGIN;');
try {
  db.exec(rest);
  db.exec('COMMIT;');
  console.log('Applied:', sqlPath);
} catch (e) {
  db.exec('ROLLBACK;');
  console.error('Failed:', e.message);
  process.exit(5);
}
