// racer/server-racer-mega.js — v1.3 (mobile UX + confetti triggers + plate points + PvP)
import express from 'express';
import * as db from '../db/db.js';

const router = express.Router();

// ---------- schema (idempotent) ----------
db.run(`CREATE TABLE IF NOT EXISTS racer_tx(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('earn','spend')),
  amount INTEGER NOT NULL,
  reason TEXT,
  ts DATETIME DEFAULT CURRENT_TIMESTAMP
)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_racer_tx_tg ON racer_tx(tg_id)`);

db.run(`CREATE TABLE IF NOT EXISTS racer_garage(
  tg_id INTEGER NOT NULL,
  car_id TEXT NOT NULL,
  level INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(tg_id, car_id)
)`);

db.run(`CREATE TABLE IF NOT EXISTS racer_races(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_id INTEGER NOT NULL,
  opponent_tg_id INTEGER,
  car_id TEXT NOT NULL,
  result TEXT NOT NULL CHECK(result IN ('win','lose','draw')),
  points_delta INTEGER NOT NULL DEFAULT 0,
  ts DATETIME DEFAULT CURRENT_TIMESTAMP,
  replay TEXT
)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_racer_races_tg ON racer_races(tg_id)`);

db.run(`CREATE TABLE IF NOT EXISTS racer_energy(
  tg_id INTEGER PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 5,
  updated_ts DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

db.run(`CREATE TABLE IF NOT EXISTS racer_challenges(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_tg INTEGER NOT NULL,
  to_tg INTEGER NOT NULL,
  car_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','declined','canceled','done')),
  created_ts DATETIME DEFAULT CURRENT_TIMESTAMP
)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_racer_chal_to ON racer_challenges(to_tg, status)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_racer_chal_from ON racer_challenges(from_tg, status)`);

// ---------- helpers ----------
function parseUser(req){
  const h = req.headers['x-tg-id'] || req.headers['x-telegram-id'];
  if (h) return { id: Number(h)||0 };
  if (req.query && req.query.tg_id) return { id: Number(req.query.tg_id)||0 };
  const init = String(req.query.init || '');
  if (init) {
    try {
      const u = JSON.parse(new URLSearchParams(init).get('user') || '{}');
      if (u && u.id) return { id: Number(u.id), username: u.username, first_name: u.first_name };
    } catch {}
  }
  return { id: 0 };
}
function requireUser(req,res,next){
  const u = parseUser(req);
  if (!u.id) return res.status(401).json({ ok:false, error:'NO_USER' });
  req.tgUser = u;
  next();
}
function requireAdmin(req,res,next){
  const header = req.headers['x-admin'];
  const ids = String(process.env.ADMIN_IDS||'').split(',').map(s=>Number(s.trim())).filter(Boolean);
  const uid = req.tgUser?.id;
  if (header === '1' || (uid && ids.includes(uid))) return next();
  return res.status(403).json({ ok:false, error:'NO_ADMIN' });
}
function getBalance(tg_id){
  const row = db.get(`
    SELECT COALESCE(SUM(CASE WHEN kind='earn' THEN amount WHEN kind='spend' THEN -amount ELSE 0 END),0) AS bal
    FROM racer_tx WHERE tg_id=?
  `, [tg_id]);
  return row ? (row.bal|0) : 0;
}
function setEnergyDefault(tg_id){
  db.run(`INSERT OR IGNORE INTO racer_energy(tg_id,value) VALUES(?,5)`, [tg_id]);
}
function energyOf(tg_id){
  setEnergyDefault(tg_id);
  const row = db.get(`SELECT value FROM racer_energy WHERE tg_id=?`, [tg_id]);
  return row ? (row.value|0) : 0;
}
function updateEnergy(tg_id, delta){
  setEnergyDefault(tg_id);
  db.run(`UPDATE racer_energy SET value = max(0, value + ?), updated_ts=CURRENT_TIMESTAMP WHERE tg_id=?`, [delta, tg_id]);
}
function platePointsOf(tg_id){
  // best-effort: если таблицы/колонок нет — вернём 0
  try{
    // Популярный вариант: bonuses(tg_id, kind TEXT, amount INTEGER, reason TEXT, ts)
    const row = db.get(`
      SELECT COALESCE(SUM(CASE
        WHEN kind IN ('spotted','plate_points') THEN amount
        WHEN kind LIKE 'spend_racer_skin%' THEN -amount
        ELSE 0 END), 0) AS pts
      FROM bonuses WHERE tg_id=?
    `, [tg_id]);
    return row ? (row.pts|0) : 0;
  }catch{ return 0; }
}

const START_ENERGY = 5;
const RACE_ENERGY_COST = 1;

// ---------- API: profile ----------
router.get('/api/racer/me', requireUser, (req,res)=>{
  try{
    const tg = req.tgUser.id;
    const bal = getBalance(tg);
    const garage = db.query(`SELECT car_id, level FROM racer_garage WHERE tg_id=? ORDER BY level DESC, car_id`, [tg]).map(r=>({car_id:r.car_id, level:r.level}));
    const energy = energyOf(tg);
    const plate_points = platePointsOf(tg);
    res.json({ ok:true, me:{ tg_id: tg, balance: bal, energy, garage, plate_points } });
  }catch(e){ res.status(500).json({ ok:false, error:'INTERNAL' }); }
});

if (process.env.NODE_ENV !== 'production') {
  router.post('/api/racer/debug/credit', requireUser, requireAdmin, (req,res)=>{
    try{
      const amount = Math.max(0, Number(req.body?.amount||0));
      if (!amount) return res.status(400).json({ok:false,error:'BAD_AMOUNT'});
      db.run(`INSERT INTO racer_tx(tg_id,kind,amount,reason) VALUES(?,?,?,?)`, [req.tgUser.id,'earn',amount,'debug_topup']);
      res.json({ok:true, balance:getBalance(req.tgUser.id)});
    }catch(e){ res.status(500).json({ok:false}); }
  });
}

// ---------- API: shop / garage ----------
router.post('/api/racer/car/buy', requireUser, (req,res)=>{
  try{
    const tg = req.tgUser.id;
    const car_id = String(req.body?.car_id||'').slice(0,64);
    const price = Math.max(0, Number(req.body?.price||0));
    if (!car_id || !price) return res.status(400).json({ok:false,error:'BAD_REQ'});
    const exists = db.get(`SELECT 1 AS x FROM racer_garage WHERE tg_id=? AND car_id=?`, [tg,car_id]);
    if (exists) return res.status(409).json({ok:false,error:'OWNED'});
    const bal = getBalance(tg);
    if (bal < price) return res.status(402).json({ok:false,error:'NO_FUNDS', balance:bal});
    db.run(`INSERT INTO racer_tx(tg_id,kind,amount,reason) VALUES(?,?,?,?)`, [tg,'spend',price,`buy_${car_id}`]);
    db.run(`INSERT INTO racer_garage(tg_id,car_id,level) VALUES(?,?,1)`, [tg,car_id]);
    res.json({ok:true, balance:getBalance(tg), garage: db.query(`SELECT car_id, level FROM racer_garage WHERE tg_id=?`,[tg])});
  }catch(e){ res.status(500).json({ok:false}); }
});

router.post('/api/racer/upgrade', requireUser, (req,res)=>{
  try{
    const tg = req.tgUser.id;
    const car_id = String(req.body?.car_id||'').slice(0,64);
    if (!car_id) return res.status(400).json({ok:false,error:'BAD_REQ'});
    const owned = db.get(`SELECT level FROM racer_garage WHERE tg_id=? AND car_id=?`, [tg,car_id]);
    if (!owned) return res.status(403).json({ok:false,error:'NOT_OWNED'});
    const level = (owned.level|0);
    const cost = 300 + level * 200;
    const bal = getBalance(tg);
    if (bal < cost) return res.status(402).json({ok:false,error:'NO_FUNDS', balance:bal});
    db.run(`INSERT INTO racer_tx(tg_id,kind,amount,reason) VALUES(?,?,?,?)`, [tg,'spend',cost,`upgrade_${car_id}_L${level+1}`]);
    db.run(`UPDATE racer_garage SET level=level+1 WHERE tg_id=? AND car_id=?`, [tg,car_id]);
    res.json({ok:true, balance:getBalance(tg), level: level+1, cost});
  }catch(e){ res.status(500).json({ok:false}); }
});

// ---------- API: PvE race ----------
router.post('/api/racer/race/start', requireUser, (req,res)=>{
  try{
    const tg = req.tgUser.id;
    const car_id = String(req.body?.car_id||'').slice(0,64);
    if (!car_id) return res.status(400).json({ok:false,error:'BAD_REQ'});
    const owned = db.get(`SELECT level FROM racer_garage WHERE tg_id=? AND car_id=?`, [tg,car_id]);
    if (!owned) return res.status(403).json({ok:false,error:'NOT_OWNED'});

    const e = energyOf(tg);
    if (e < 1) return res.status(429).json({ok:false,error:'NO_ENERGY', energy:e});
    updateEnergy(tg, -1);

    const lvl = owned.level|0;
    const playerPower = 100 + lvl*15;
    const aiPower = 90 + Math.floor(Math.random()*40);
    let p=0,a=0; const replay=[]; const steps=60;
    for (let i=0;i<steps;i++){
      p += Math.random()*(playerPower/100);
      a += Math.random()*(aiPower/100);
      replay.push({t:i*80,p:Math.min(100,p),a:Math.min(100,a)});
    }
    const result = (p>a+1) ? 'win' : (a>p+1 ? 'lose' : 'draw');
    let delta=0, prize=0;
    if (result==='win'){ delta=+10; prize=+50; }
    else if (result==='draw'){ delta=+2; prize=+10; }
    else { delta=-5; prize=0; }
    if (prize>0) db.run(`INSERT INTO racer_tx(tg_id,kind,amount,reason) VALUES(?,?,?,?)`, [tg,'earn',prize,'race_reward']);
    db.run(`INSERT INTO racer_races(tg_id,opponent_tg_id,car_id,result,points_delta,replay) VALUES(?,?,?,?,?,?)`, [tg,null,car_id,result,delta,JSON.stringify(replay)]);

    res.json({ ok:true, result, points_delta:delta, prize, energy:energyOf(tg), replay, balance:getBalance(tg) });
  }catch(e){ res.status(500).json({ok:false}); }
});

// ---------- API: PvP ----------
router.get('/api/racer/pvp/list', requireUser, (req,res)=>{
  try{
    const tg = req.tgUser.id;
    const incoming = db.query(`SELECT * FROM racer_challenges WHERE to_tg=? AND status='pending' ORDER BY id DESC LIMIT 50`, [tg]);
    const outgoing = db.query(`SELECT * FROM racer_challenges WHERE from_tg=? AND status='pending' ORDER BY id DESC LIMIT 50`, [tg]);
    const history = db.query(`SELECT * FROM racer_challenges WHERE (from_tg=? OR to_tg=?) AND status!='pending' ORDER BY id DESC LIMIT 50`, [tg,tg]);
    res.json({ok:true, incoming, outgoing, history});
  }catch(e){ res.status(500).json({ok:false}); }
});

router.post('/api/racer/pvp/challenge', requireUser, (req,res)=>{
  try{
    const tg = req.tgUser.id;
    const to_tg = Number(req.body?.to_tg||0);
    const car_id = String(req.body?.car_id||'').slice(0,64);
    if (!to_tg || !car_id) return res.status(400).json({ok:false,error:'BAD_REQ'});
    const owned = db.get(`SELECT 1 AS x FROM racer_garage WHERE tg_id=? AND car_id=?`, [tg,car_id]);
    if (!owned) return res.status(403).json({ok:false,error:'NOT_OWNED'});
    db.run(`INSERT INTO racer_challenges(from_tg,to_tg,car_id,status) VALUES(?,?,?,'pending')`, [tg,to_tg,car_id]);
    const row = db.get(`SELECT last_insert_rowid() AS id`);
    res.json({ok:true, id: row.id});
  }catch(e){ res.status(500).json({ok:false}); }
});

router.post('/api/racer/pvp/decline', requireUser, (req,res)=>{
  try{
    const tg = req.tgUser.id;
    const id = Number(req.body?.challenge_id||0);
    const row = db.get(`SELECT * FROM racer_challenges WHERE id=?`, [id]);
    if (!row) return res.status(404).json({ok:false,error:'NO_CHAL'});
    if (row.to_tg !== tg) return res.status(403).json({ok:false,error:'FORBIDDEN'});
    if (row.status!=='pending') return res.status(400).json({ok:false,error:'BAD_STATE'});
    db.run(`UPDATE racer_challenges SET status='declined' WHERE id=?`, [id]);
    res.json({ok:true});
  }catch(e){ res.status(500).json({ok:false}); }
});

router.post('/api/racer/pvp/cancel', requireUser, (req,res)=>{
  try{
    const tg = req.tgUser.id;
    const id = Number(req.body?.challenge_id||0);
    const row = db.get(`SELECT * FROM racer_challenges WHERE id=?`, [id]);
    if (!row) return res.status(404).json({ok:false,error:'NO_CHAL'});
    if (row.from_tg !== tg) return res.status(403).json({ok:false,error:'FORBIDDEN'});
    if (row.status!=='pending') return res.status(400).json({ok:false,error:'BAD_STATE'});
    db.run(`UPDATE racer_challenges SET status='canceled' WHERE id=?`, [id]);
    res.json({ok:true});
  }catch(e){ res.status(500).json({ok:false}); }
});

router.post('/api/racer/pvp/accept', requireUser, (req,res)=>{
  try{
    const tg = req.tgUser.id;
    const id = Number(req.body?.challenge_id||0);
    const row = db.get(`SELECT * FROM racer_challenges WHERE id=?`, [id]);
    if (!row) return res.status(404).json({ok:false,error:'NO_CHAL'});
    if (row.to_tg !== tg) return res.status(403).json({ok:false,error:'FORBIDDEN'});
    if (row.status!=='pending') return res.status(400).json({ok:false,error:'BAD_STATE'});

    // energy check both
    const eTo = energyOf(row.to_tg);
    const eFrom = energyOf(row.from_tg);
    if (eTo<1 || eFrom<1) return res.status(429).json({ok:false,error:'NO_ENERGY', eFrom, eTo});
    updateEnergy(row.to_tg, -1); updateEnergy(row.from_tg, -1);

    // choose levels
    const fromOwned = db.get(`SELECT level FROM racer_garage WHERE tg_id=? AND car_id=?`, [row.from_tg,row.car_id]);
    const toOwned = db.get(`SELECT car_id, level FROM racer_garage WHERE tg_id=? ORDER BY level DESC LIMIT 1`, [row.to_tg]);
    if (!fromOwned) return res.status(400).json({ok:false,error:'FROM_NO_CAR'});
    if (!toOwned) return res.status(400).json({ok:false,error:'TO_NO_CAR'});

    const aPow = 100 + (fromOwned.level|0)*15;
    const bPow = 100 + (toOwned.level|0)*15;
    let p=0,a=0; const replay=[]; const steps=60;
    for (let i=0;i<steps;i++){
      p += Math.random()*(aPow/100);
      a += Math.random()*(bPow/100);
      replay.push({t:i*80,p:Math.min(100,p),a:Math.min(100,a)});
    }
    const fromWins = p>a+1 ? true : a>p+1 ? false : null;
    let resFrom='draw', resTo='draw', deltaFrom=+3, deltaTo=+3, prizeFrom=10, prizeTo=10;
    if (fromWins===true){ resFrom='win'; resTo='lose'; deltaFrom=+15; deltaTo=-7; prizeFrom=70; prizeTo=0; }
    if (fromWins===false){ resFrom='lose'; resTo='win'; deltaFrom=-7; deltaTo=+15; prizeFrom=0; prizeTo=70; }

    if (prizeFrom>0) db.run(`INSERT INTO racer_tx(tg_id,kind,amount,reason) VALUES(?,?,?,?)`, [row.from_tg,'earn',prizeFrom,'pvp_reward']);
    if (prizeTo>0)   db.run(`INSERT INTO racer_tx(tg_id,kind,amount,reason) VALUES(?,?,?,?)`, [row.to_tg,'earn',prizeTo,'pvp_reward']);
    db.run(`INSERT INTO racer_races(tg_id,opponent_tg_id,car_id,result,points_delta,replay) VALUES(?,?,?,?,?,?)`, [row.from_tg,row.to_tg,row.car_id,resFrom,deltaFrom,JSON.stringify(replay)]);
    db.run(`INSERT INTO racer_races(tg_id,opponent_tg_id,car_id,result,points_delta,replay) VALUES(?,?,?,?,?,?)`, [row.to_tg,row.from_tg,toOwned.car_id,resTo,deltaTo,JSON.stringify(replay)]);
    db.run(`UPDATE racer_challenges SET status='done' WHERE id=?`, [id]);

    res.json({ ok:true,
      from: { tg_id: row.from_tg, result: resFrom, delta: deltaFrom, prize: prizeFrom, balance:getBalance(row.from_tg), energy: energyOf(row.from_tg) },
      to:   { tg_id: row.to_tg,   result: resTo,   delta: deltaTo,   prize: prizeTo,   balance:getBalance(row.to_tg),   energy: energyOf(row.to_tg) },
      replay
    });
  }catch(e){ res.status(500).json({ok:false}); }
});

// ---------- API: leaderboard ----------
router.get('/api/racer/leaderboard', (req,res)=>{
  try{
    const rows = db.query(`
      SELECT tg_id, COALESCE(SUM(points_delta),0) AS pts, COUNT(*) AS races
      FROM racer_races
      GROUP BY tg_id
      ORDER BY pts DESC, races DESC
      LIMIT 50
    `);
    res.json({ok:true, rows});
  }catch(e){ res.status(500).json({ok:false}); }
});

export default router;
