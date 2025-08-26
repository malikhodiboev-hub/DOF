import fs from 'fs';
import { run } from './db.js';
import path from 'path';
const schema = fs.readFileSync(path.join(process.cwd(),'db','schema.sql'),'utf-8');
schema.split(/;\s*\n/).map(s=>s.trim()).filter(Boolean).forEach(sql=>run(sql));
console.log('SQLite schema applied.');
