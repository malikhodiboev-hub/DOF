
import express from 'express';
import helmet from 'helmet';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import racer from './racer/server-racer-mega.js';

// DB helpers (better-sqlite3 wrappers in your project)
import { query, run, get } from './db/db.js';
import { validateInitData } from './lib/validateInitData.js';

dotenv.config();

const app = express();

// --- Security headers (CSP friendly with Telegram WebApp) ---
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://telegram.org", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https:"],
      frameAncestors: ["'self'", "https://web.telegram.org", "https://t.me"]
    }
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

app.use(express.json({ limit: '5mb' }));
app.use(express.static('public', { maxAge: '1h', extensions: ['html'] }));

app.use('/webapp/racer', express.static(path.join(process.cwd(), 'public/webapp/racer')));
app.use(racer);

// Paths
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ================= FULL ROUTES (single source of truth) =================

// --- helpers & auth ---
const ADMIN_IDS = new Set(String(process.env.ADMIN_TG_IDS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean));

function parseInitData(req){
  if (req.tgInit) return req.tgInit;
  const init = req.get('X-Telegram-Init-Data') || '';
  const token = process.env.BOT_TOKEN || '';
  const res = validateInitData(init, token);
  if (!res.ok || !res.data.user) return req.tgInit = { error: 'INVALID_SIGNATURE' };
  try {
    const user = JSON.parse(res.data.user);
    return req.tgInit = { user };
  } catch {
    return req.tgInit = { error: 'INVALID_USER' };
  }
}

function requireUser(req, res, next){
  const { user, error } = parseInitData(req);
  if (!user || !user.id) return res.status(401).json({ ok:false, error: error || 'NO_TELEGRAM_USER' });
  req.tgUser = user;
  next();
}
function requireAdmin(req, res, next){
  const { user, error } = parseInitData(req);
  if (!user || !user.id) return res.status(401).json({ ok:false, error: error || 'NO_TELEGRAM_USER' });
  if (!ADMIN_IDS.has(String(user.id))) return res.status(403).json({ ok:false, error:'FORBIDDEN' });
  req.tgUser = user;
  next();
}

// --- RULES & HOWTO ---
app.get('/api/rules', (req, res) => {
  const HASHTAG = process.env.ACTIVE_HASHTAG || '#plates';
  const BONUS = Number(process.env.SPOTTED_BONUS || 5);
  const text = [
    `Хэштег: ${HASHTAG}`,
    'Уникальный номер: +10',
    `«Засмотр» (кто-то сфоткал ваш зарегистрированный номер): +${BONUS}`,
    'Дубликаты у одного игрока не засчитываются'
  ].join('\\n');
  const howto = [
    '1) Откройте веб‑приложение из бота.',
    `2) Сфотографируйте авто и добавьте хэштег ${HASHTAG} в подпись.`,
    '3) Отправьте фото — бот распознает номер и начислит +10 за уникальный номер.',
    '4) Зарегистрируйте свои номера (инлайн «➕ Зарегистрировать»).',
    '5) Если кто-то сфотает ваш номер — получите бонус.',
    '6) Следите за рейтингом в «🏆 Топ».'
  ].join('\\n');
  res.json({ ok:true, text, howto });
});

// --- PUBLIC LEADERBOARD ---
app.get('/api/leaderboard', (req, res) => {
  try {
    const game = Number(process.env.ACTIVE_GAME_ID || 1);
    const rows = query(`
      SELECT u.tg_id, COALESCE(u.username,'') username, COALESCE(u.first_name,'') first_name,
             COALESCE(u.last_name,'') last_name,
             COALESCE(SUM(CASE WHEN IFNULL(s.is_valid,1) <> 0 THEN IFNULL(s.points,0) ELSE 0 END),0)
               + COALESCE(SUM(b.amount),0) total_points,
             COUNT(DISTINCT CASE WHEN IFNULL(s.is_valid,1) <> 0 THEN s.plate_text END) unique_plates
      FROM users u
      LEFT JOIN submissions s ON s.tg_id=u.tg_id AND s.game_id=?
      LEFT JOIN bonuses b ON b.tg_id=u.tg_id AND b.game_id=?
      GROUP BY u.tg_id, u.username, u.first_name, u.last_name
      ORDER BY total_points DESC, unique_plates DESC
      LIMIT 50`, [game, game]);
    res.json({ ok:true, leaderboard: rows });
  } catch (e) { res.status(500).json({ ok:false, error:'LEADERBOARD_FAILED' }); }
});

// --- ME (requires Telegram user) ---
app.get('/api/me', requireUser, (req, res) => {
  try {
    const game = Number(process.env.ACTIVE_GAME_ID || 1);
    const tg_id = req.tgUser.id;
    const me = get(`select tg_id, username, first_name, last_name from users where tg_id=?`, [tg_id]) || {
      tg_id, username:req.tgUser.username, first_name:req.tgUser.first_name, last_name:req.tgUser.last_name
    };
    const score = get(`
      SELECT COALESCE(SUM(CASE WHEN IFNULL(s.is_valid,1) <> 0 THEN IFNULL(s.points,0) ELSE 0 END),0) s,
             COALESCE(SUM(b.amount),0) b,
             COUNT(DISTINCT CASE WHEN IFNULL(s.is_valid,1) <> 0 THEN s.plate_text END) u
      FROM users u
      LEFT JOIN submissions s ON s.tg_id=u.tg_id AND s.game_id=?
      LEFT JOIN bonuses b ON b.tg_id=u.tg_id AND b.game_id=?
      WHERE u.tg_id=?`, [game, game, tg_id]) || { s:0,b:0,u:0 };
    const cars = query(`select plate_text from car_plates where tg_id=? order by created_at desc`, [tg_id]).map(r=>r.plate_text);
    res.json({ ok:true, me: {
      tg_id, username: me.username || req.tgUser.username, first_name: me.first_name || req.tgUser.first_name, last_name: me.last_name || req.tgUser.last_name,
      total_points: (score.s||0) + (score.b||0), unique_plates: score.u||0
    }, my_cars: cars });
  } catch (e) { res.status(500).json({ ok:false, error:'ME_FAILED' }); }
});


app.get('/api/me/avatar', (req, res) => {
  try {
    const init = new URLSearchParams(String(req.query.init || ''));
    const uStr = init.get('user'); const u = uStr ? JSON.parse(uStr) : {};
    const letter = String(u.first_name || u.username || 'U').charAt(0).toUpperCase();
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='96' height='96'>
      <rect width='100%' height='100%' fill='#e5e7eb'/>
      <text x='50%' y='54%' dominant-baseline='middle' text-anchor='middle'
            font-size='36' fill='#6b7280' font-family='system-ui,Segoe UI,Roboto,sans-serif'>${letter}</text>
    </svg>`;
    res.set('Content-Type','image/svg+xml').send(svg);
  } catch { res.status(404).end(); }
});


// --- USER CAR MANAGEMENT ---
function normPlate(s){ return String(s||'').toUpperCase().replace(/[^A-Z0-9]/g,''); }

app.post('/api/cars/add', requireUser, (req, res) => {
  const plate = normPlate(req.body?.plate || '');
  if (!plate || plate.length < 4) return res.status(400).json({ ok:false, error:'INVALID_PLATE' });
  try {
    run(`insert into car_plates (tg_id, plate_text) values (?, ?)`, [req.tgUser.id, plate]);
    res.json({ ok:true });
  } catch (e) {
    res.status(409).json({ ok:false, error:'ALREADY_REGISTERED' });
  }
});

app.post('/api/cars/delete', requireUser, (req, res) => {
  const plate = normPlate(req.body?.plate || '');
  if (!plate) return res.status(400).json({ ok:false, error:'INVALID_PLATE' });
  try {
    const r = run(`delete from car_plates where tg_id=? and plate_text=?`, [req.tgUser.id, plate]);
    res.json({ ok: r.changes > 0 });
  } catch (e) { res.status(500).json({ ok:false, error:'DELETE_FAILED' }); }
});

// --- ADMIN API (require admin) ---
app.get('/api/admin/summary', requireAdmin, (req, res)=>{
  try{
    const users = get(`select count(*) c from users`)?.c || 0;
    const submissions = get(`select count(*) c from submissions`)?.c || 0;
    const unique_plates = get(`select count(distinct plate_text) c from submissions where ifnull(is_valid,1) <> 0`)?.c || 0;
    const cars = get(`select count(*) c from car_plates`)?.c || 0;
    res.json({ ok:true, users, submissions, unique_plates, cars });
  }catch(e){ res.status(500).json({ ok:false }); }
});

app.get('/api/admin/leaderboard', requireAdmin, (req, res)=>{
  const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
  try{
    const game = Number(process.env.ACTIVE_GAME_ID || 1);
    const items = query(`
      SELECT u.tg_id, COALESCE(u.username,'') username, COALESCE(u.first_name,'') first_name,
             COALESCE(u.last_name,'') last_name,
             COALESCE(SUM(CASE WHEN IFNULL(s.is_valid,1) <> 0 THEN IFNULL(s.points,0) ELSE 0 END),0)
               + COALESCE(SUM(b.amount),0) total_points,
             COUNT(DISTINCT CASE WHEN IFNULL(s.is_valid,1) <> 0 THEN s.plate_text END) unique_plates
      FROM users u
      LEFT JOIN submissions s ON s.tg_id=u.tg_id AND s.game_id=?
      LEFT JOIN bonuses b ON b.tg_id=u.tg_id AND b.game_id=?
      GROUP BY u.tg_id, u.username, u.first_name, u.last_name
      ORDER BY total_points DESC, unique_plates DESC
      LIMIT ?`, [game, game, limit]);
    res.json({ ok:true, items });
  }catch(e){ res.status(500).json({ ok:false }); }
});

app.get('/api/admin/users', requireAdmin, (req, res)=>{
  const q = String(req.query.q||'').trim();
  try{
    let items = [];
    const game = Number(process.env.ACTIVE_GAME_ID || 1);
    if (/^\d{5,}$/.test(q)) {
      items = query(`
        SELECT u.tg_id, COALESCE(u.username,'') username, COALESCE(u.first_name,'') first_name, COALESCE(u.last_name,'') last_name,
               COALESCE(SUM(CASE WHEN IFNULL(s.is_valid,1) <> 0 THEN IFNULL(s.points,0) ELSE 0 END),0)
                 + COALESCE(SUM(b.amount),0) total_points,
               COUNT(DISTINCT CASE WHEN IFNULL(s.is_valid,1) <> 0 THEN s.plate_text END) unique_plates
        FROM users u
        LEFT JOIN submissions s ON s.tg_id=u.tg_id AND s.game_id=?
        LEFT JOIN bonuses b ON b.tg_id=u.tg_id AND b.game_id=?
        WHERE u.tg_id=?
        GROUP BY u.tg_id, u.username, u.first_name, u.last_name
        LIMIT 50`, [game, game, Number(q)]);
    } else {
      const like = `%${q.replace(/%/g,'').replace(/_/g,'')}%`;
      items = query(`
        SELECT u.tg_id, COALESCE(u.username,'') username, COALESCE(u.first_name,'') first_name, COALESCE(u.last_name,'') last_name,
               COALESCE(SUM(CASE WHEN IFNULL(s.is_valid,1) <> 0 THEN IFNULL(s.points,0) ELSE 0 END),0)
                 + COALESCE(SUM(b.amount),0) total_points,
               COUNT(DISTINCT CASE WHEN IFNULL(s.is_valid,1) <> 0 THEN s.plate_text END) unique_plates
        FROM users u
        LEFT JOIN submissions s ON s.tg_id=u.tg_id AND s.game_id=?
        LEFT JOIN bonuses b ON b.tg_id=u.tg_id AND b.game_id=?
        WHERE lower(u.username) like lower(?) OR lower(u.first_name) like lower(?) OR lower(u.last_name) like lower(?)
        GROUP BY u.tg_id, u.username, u.first_name, u.last_name
        ORDER BY total_points DESC
        LIMIT 50`, [game, game, like, like, like]);
    }
    // attach cars
    const ids = items.map(i=>i.tg_id);
    let cars = [];
    if (ids.length){
      cars = query(`select tg_id, plate_text from car_plates where tg_id in (${ids.map(()=>'?').join(',')})`, ids);
    }
    const byUser = {};
    cars.forEach(c => { (byUser[c.tg_id] ||= []).push(c.plate_text); });
    items.forEach(i => i.cars = byUser[i.tg_id] || []);
    res.json({ ok:true, items });
  }catch(e){ res.status(500).json({ ok:false }); }
});

app.post('/api/admin/bonus', requireAdmin, (req, res)=>{
  const tg_id = Number(req.body?.tg_id||0); const amount = Number(req.body?.amount||0);
  const reason = String(req.body?.reason||'manual').slice(0,200);
  if (!tg_id || !amount) return res.status(400).json({ ok:false, error:'BAD_INPUT' });
  try{
    const game = Number(process.env.ACTIVE_GAME_ID || 1);
    run(`insert into bonuses (tg_id, game_id, kind, amount, reason) values (?,?,?,?,?)`,
        [tg_id, game, 'manual', amount, reason]);
    res.json({ ok:true });
  }catch(e){ res.status(500).json({ ok:false }); }
});

// ================= /FULL ROUTES =================

// Web app entry points
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'webapp', 'index.html')));
app.get('/webapp/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'webapp', 'index.html')));
app.get('/webapp/admin/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'webapp', 'admin', 'index.html')));

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '127.0.0.1';
const server = app.listen(PORT, HOST, () => console.log(`Web on http://${HOST}:${PORT}`));
server.on('error', (err) => { console.error('[web] listen error:', err); process.exit(1); });

