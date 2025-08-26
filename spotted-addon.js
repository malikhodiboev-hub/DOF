
// spotted-addon.js (ESM) — drop-in "spotted bonus + notify owner" feature for Telegraf bot
// Usage in your bot.js:
//   import * as spotted from './spotted-addon.js';
//   await spotted.install(); // once on startup
//   // ... inside your photo handler, AFTER you insert a submission and have submission_id:
//   await spotted.awardSpotted({ bot, plate: normalizedPlate, submission_id, submitter_tg_id: ctx.from.id });

import * as db from './db/db.js';

const SPOTTED_BONUS = Number(process.env.SPOTTED_BONUS || 5);
const GAME_ID = Number(process.env.ACTIVE_GAME_ID || 1);

export async function install(){
  // create a small log table to avoid duplicate awards per submission per owner
  db.run(`CREATE TABLE IF NOT EXISTS spotted_log(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    submission_id INTEGER NOT NULL,
    owner_tg_id INTEGER NOT NULL,
    plate_text TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(owner_tg_id, submission_id)
  );`);
}

function normPlate(s){ return String(s||'').toUpperCase().replace(/[^A-Z0-9]/g,''); }

export async function awardSpotted({ bot, plate, submission_id, submitter_tg_id }){
  try{
    const p = normPlate(plate);
    if (!p) return;

    // find all owners who registered exactly this plate
    const owners = db.query(`SELECT DISTINCT tg_id FROM car_plates WHERE plate_text=?`, [p]).map(r=>r.tg_id);

    for (const owner of owners){
      if (Number(owner) === Number(submitter_tg_id)) continue; // don't award self

      // skip if already awarded for this submission
      const exists = db.get(`SELECT 1 AS x FROM spotted_log WHERE owner_tg_id=? AND submission_id=?`, [owner, submission_id]);
      if (exists && exists.x) continue;

      db.run(`INSERT INTO spotted_log (owner_tg_id, submission_id, plate_text) VALUES (?,?,?)`, [owner, submission_id, p]);
      db.run(`INSERT INTO bonuses (tg_id, game_id, kind, amount, reason) VALUES (?,?,?,?,?)`,
        [owner, GAME_ID, 'spotted', SPOTTED_BONUS, `spotted:${p}:${submission_id}`]);

      // notify owner privately; ignore failures (blocked bot, etc.)
      try {
        await bot.telegram.sendMessage(owner, `🚨 Ваш автомобиль с номером ${p} был замечен в игре.\nВам начислен бонус +${SPOTTED_BONUS} очков.`);
      } catch {}
    }
  }catch(e){
    console.error('[spotted-addon] failed to award', e);
  }
}
