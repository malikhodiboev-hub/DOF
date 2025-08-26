
import { Telegraf, Markup } from 'telegraf';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import { run, query, get } from './db/db.js';
import * as spotted from './spotted-addon.js';
import installRacerDM from './bot_addons/racer-bot-addon.js';

dotenv.config();
const bot = new Telegraf(process.env.BOT_TOKEN);


// ---------- CONFIG ----------
const PUBLIC_BASE = (process.env.PUBLIC_BASE_URL || 'http://localhost:8080').replace(/\/+$/, '');
// Ссылки на WebApp
const RACER_URL = `${PUBLIC_BASE}/webapp/racer/`;
const ADMIN_URL = `${PUBLIC_BASE}/webapp/admin/`;
const MAIN_URL  = `${PUBLIC_BASE}/webapp/`;  
const ACTIVE_GAME_ID   = Number(process.env.ACTIVE_GAME_ID || 1);
const ACTIVE_HASHTAG   = process.env.ACTIVE_HASHTAG || '#plates';
const PUBLIC_BASE_URL  = process.env.PUBLIC_BASE_URL || 'http://localhost:8080';
const SPOTTED_BONUS    = Number(process.env.SPOTTED_BONUS || 5);
const adminIds = new Set(String(process.env.ADMIN_TG_IDS || '').split(',').map(s=>s.trim()).filter(Boolean));

// Auto-delete (anti-spam)
const GROUP_TTL   = Number(process.env.AUTODELETE_GROUP_SEC || 25);
const PROMPT_TTL  = Number(process.env.AUTODELETE_PROMPT_SEC || 90);
const DELETE_USER_MSG = String(process.env.AUTODELETE_DELETE_USER_MESSAGES || 'true').toLowerCase() === 'true';

// ---------- HELPERS ----------
function hasHashtag(caption) { return !!caption && caption.toLowerCase().includes(ACTIVE_HASHTAG.toLowerCase()); }
function normPlate(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function fmt(n){ try{ return new Intl.NumberFormat('ru-RU').format(n||0);}catch{ return String(n||0); } }
function isGroup(ctx){ return ['group','supergroup'].includes(ctx.chat?.type); }
function isAdmin(ctx){ return adminIds.has(String(ctx.from?.id)); }
function rulesText(){
  return [
    `Хэштег: ${ACTIVE_HASHTAG}`,
    'Уникальный номер: +10',
    `«#Засмотруй» (кто-то сфоткал ваш зарегистрированный номер): +${SPOTTED_BONUS}`,
    'Дубликаты у одного игрока не засчитываются',
    '',
    'Как играть:',
    `1) Сфотографируй авто и добавь хэштег ${ACTIVE_HASHTAG}.`,
    '2) Отправь фото боту — бот распознаёт номер и начислит очки.',
    '3) Зарегистрируй свои номера (инлайн «➕ Зарегистрировать»).',
    '4) Если кто-то сфотает твой номер — ты получишь бонус.',
    '5) Смотри рейтинг в «🏆 Топ».'
  ].join('\n');
}

// Auto delete helpers
async function autoDeleteMessage(ctx, messageId, ttlSec) {
  if (!isGroup(ctx)) return;
  if (!messageId) return;
  setTimeout(async () => {
    try { await ctx.telegram.deleteMessage(ctx.chat.id, messageId); } catch(e) {}
  }, Math.max(2, ttlSec)*1000);
}
async function autoDeleteUserMessage(ctx, ttlSec) {
  if (!isGroup(ctx) || !DELETE_USER_MSG) return;
  const msgId = ctx.message?.message_id;
  if (!msgId) return;
  await autoDeleteMessage(ctx, msgId, ttlSec);
}
async function replyDel(ctx, text, extra={}, ttlSec=GROUP_TTL) {
  const m = await ctx.reply(text, extra);
  await autoDeleteMessage(ctx, m?.message_id, ttlSec);
  return m;
}

// Simple per-user nav memory
const nav = new Map(); // userId -> section
function setNav(userId, section){ nav.set(userId, section); setTimeout(()=>{ if(nav.get(userId)===section) nav.delete(userId); }, 3600_000); }

// Pending input memory (register/delete plate)
const pending = new Map(); // userId -> { action, until, promptMsgId }
const TTL_MS = 2*60*1000;
function setPending(userId, action, promptMsgId){ pending.set(userId, {action, until: Date.now()+TTL_MS, promptMsgId}); }
function getPending(userId){ const p=pending.get(userId); if(!p) return null; if(Date.now()>p.until){ pending.delete(userId); return null;} return p; }
function clearPending(userId){ pending.delete(userId); }

// OCR via external provider (Plate Recognizer)
async function detectPlateFromUrl(imgUrl) {
  const url = process.env.OCR_EXTERNAL_URL;
  const key = process.env.OCR_EXTERNAL_API_KEY;
  if (!url || !key) return '';
  const form = new URLSearchParams();
  form.set('upload_url', imgUrl);
  try {
    const resp = await fetch(url, { method: 'POST', headers: { 'Authorization': `Token ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: form });
    const data = await resp.json().catch(()=> ({}));
    return normPlate(data?.results?.[0]?.plate || '');
  } catch { return ''; }
}
async function getTelegramFileUrl(ctx, fileId) { const url = await ctx.telegram.getFileLink(fileId); return String(url); }

// ---------- MINIMAL SCHEMA ENSURE (idempotent) ----------
function ensureSchema(){
  run(`CREATE TABLE IF NOT EXISTS users(
    tg_id INTEGER PRIMARY KEY,
    username TEXT, first_name TEXT, last_name TEXT
  )`);
  run(`CREATE TABLE IF NOT EXISTS car_plates(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tg_id INTEGER NOT NULL,
    plate_text TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tg_id, plate_text)
  )`);
  run(`CREATE TABLE IF NOT EXISTS submissions(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tg_id INTEGER NOT NULL,
    game_id INTEGER NOT NULL,
    photo_id TEXT,
    plate_text TEXT NOT NULL,
    is_valid INTEGER DEFAULT 1,
    points INTEGER DEFAULT 10,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tg_id, game_id, plate_text)
  )`);
  run(`CREATE TABLE IF NOT EXISTS bonuses(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tg_id INTEGER NOT NULL,
    game_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    amount INTEGER NOT NULL,
    reason TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
}
ensureSchema();
await spotted.install();

// ---------- MENUS ----------
function menuFor(section, ctx) {
  const base = `${PUBLIC_BASE}/`;   // раньше было PUBLIC_BASE_URL — такой переменной нет
  const rows = [];
  
  rows.push([ Markup.button.webApp('🌐 Открыть сайт', MAIN_URL) ]);

  // Всегда первая строка — запуск игры
  rows.push([ Markup.button.webApp('🚀 Открыть Стритрейсер', RACER_URL) ]);

  if (section === 'home') {
    rows.push([ Markup.button.callback('🏆 Топ-10','top'),
                Markup.button.callback('📜 Правила','rules') ]);
    rows.push([ Markup.button.callback('🚗 Мои авто','mycars'),
                Markup.button.callback('➕ Зарегистрировать','register_prompt') ]);
    if (isAdmin(ctx)) {
      rows.push([ Markup.button.webApp('🔧 Админка', ADMIN_URL),
                  Markup.button.callback('👑 Admin','admin_section') ]);
    }
    return Markup.inlineKeyboard(rows);
  }

  if (section === 'cars') {
    rows.push([ Markup.button.callback('➕ Добавить','register_prompt') ]);
    rows.push([ Markup.button.callback('🗑 Удалить номер','delete_prompt') ]);
    rows.push([ Markup.button.callback('↩️ Меню','home') ]);
    return Markup.inlineKeyboard(rows);
  }

  if (section === 'register') {
    rows.push([ Markup.button.callback('↩️ Меню','home') ]);
    return Markup.inlineKeyboard(rows);
  }

  if (section === 'admin' && isAdmin(ctx)) {
    rows.push([ Markup.button.webApp('🔧 Открыть админку', ADMIN_URL) ]);
    rows.push([ Markup.button.callback('↩️ Меню','home') ]);
    return Markup.inlineKeyboard(rows);
  }

  if (section === 'top' || section === 'rules') {
    rows.push([ Markup.button.callback('↩️ Меню','home') ]);
    return Markup.inlineKeyboard(rows);
  }

  return menuFor('home', ctx);
}
// ---------- COMMANDS ----------
bot.start(async (ctx) => {
  setNav(ctx.from.id, 'home');
  // upsert user
  try {
    run(`INSERT INTO users (tg_id, username, first_name, last_name) VALUES (?,?,?,?)
         ON CONFLICT(tg_id) DO UPDATE SET username=excluded.username, first_name=excluded.first_name, last_name=excluded.last_name`,
        [ctx.from.id, ctx.from.username || null, ctx.from.first_name || null, ctx.from.last_name || null]);
  } catch {}
  await replyDel(
    ctx,
    'Добро пожаловать! Отправь фото номера с хэштегом ' + ACTIVE_HASHTAG + '.',
    menuFor('home', ctx)
  );
  await autoDeleteUserMessage(ctx, GROUP_TTL);
});
bot.command('menu', async (ctx)=> { setNav(ctx.from.id, 'home'); await replyDel(ctx, 'Меню:', menuFor('home', ctx)); await autoDeleteUserMessage(ctx, GROUP_TTL); });
bot.command('admin', async (ctx)=> { 
  if (!isAdmin(ctx)) return replyDel(ctx, '⛔ Доступ только для админов.', menuFor('home', ctx));
  setNav(ctx.from.id, 'admin');
  await replyDel(ctx, 'Админ-раздел:', menuFor('admin', ctx));
  await autoDeleteUserMessage(ctx, GROUP_TTL);
});

// ---------- INLINE ACTIONS ----------
bot.action('home', async (ctx)=>{ await ctx.answerCbQuery(); setNav(ctx.from.id,'home'); await replyDel(ctx, 'Меню:', menuFor('home', ctx)); });
bot.action('rules', async (ctx)=>{ await ctx.answerCbQuery(); setNav(ctx.from.id,'rules'); await replyDel(ctx, rulesText(), menuFor('rules', ctx)); });
bot.action('top', async (ctx) => {
  await ctx.answerCbQuery();
  setNav(ctx.from.id,'top');
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
    LIMIT 10`, [ACTIVE_GAME_ID, ACTIVE_GAME_ID]);
  const lines = rows.map((r, i) => {
    const name = r.first_name || r.username ? `${r.first_name || ''} ${r.username ? '@'+r.username : ''}`.trim() : `ID ${r.tg_id}`;
    return `${i+1}. ${name} — ${fmt(r.total_points)} • 🔢 ${fmt(r.unique_plates)}`;
  });
  await replyDel(ctx, lines.length ? `🏆 Топ-10:\n` + lines.join('\n') : 'Пока пусто.', menuFor('top', ctx));
});
bot.action('mycars', async (ctx) => {
  await ctx.answerCbQuery();
  setNav(ctx.from.id,'cars');
  const rows = query(`select plate_text from car_plates where tg_id=? order by created_at desc`, [ctx.from.id]);
  await replyDel(ctx, rows.length ? ('Ваши номера:\n' + rows.map(r=>`• ${r.plate_text}`).join('\n')) : 'У вас пока нет зарегистрированных номеров.', menuFor('cars', ctx));
});
bot.action('register_prompt', async (ctx) => {
  await ctx.answerCbQuery();
  setNav(ctx.from.id,'register');
  const m = await ctx.reply('Введите номер (латиница/цифры), например: ABC123', { reply_markup: { force_reply: true } });
  setPending(ctx.from.id, 'register', m.message_id);
  await autoDeleteMessage(ctx, m.message_id, PROMPT_TTL);
  await replyDel(ctx, 'Когда закончите, вернитесь в меню.', menuFor('register', ctx));
});
bot.action('delete_prompt', async (ctx) => {
  await ctx.answerCbQuery();
  setNav(ctx.from.id,'cars');
  const rows = query(`select plate_text from car_plates where tg_id=? order by created_at desc`, [ctx.from.id]);
  if (!rows.length) return replyDel(ctx, 'У вас нет зарегистрированных номеров.', menuFor('cars', ctx));
  if (rows.length <= 12) {
    const buttons = rows.map(r => [Markup.button.callback(`🗑 ${r.plate_text}`, `del:${r.plate_text}`)]);
    buttons.push([Markup.button.callback('↩️ Меню','home')]);
    const m = await ctx.reply('Выберите номер для удаления:', Markup.inlineKeyboard(buttons));
    await autoDeleteMessage(ctx, m.message_id, PROMPT_TTL);
  } else {
    const m = await ctx.reply('Много номеров. Введите номер, который удалить:', { reply_markup: { force_reply: true } });
    setPending(ctx.from.id, 'delete', m.message_id);
    await autoDeleteMessage(ctx, m.message_id, PROMPT_TTL);
    await replyDel(ctx, 'Когда закончите, вернитесь в меню.', menuFor('cars', ctx));
  }
});
bot.action('admin_section', async (ctx)=>{
  await ctx.answerCbQuery();
  if (!isAdmin(ctx)) return replyDel(ctx, '⛔ Доступ только для админов.', menuFor('home', ctx));
  setNav(ctx.from.id,'admin');
  await replyDel(ctx, 'Админ-раздел:', menuFor('admin', ctx));
});
bot.action(/^del:(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  setNav(ctx.from.id,'cars');
  const plate = normPlate(decodeURIComponent(ctx.match[1]));
  const res = run(`delete from car_plates where tg_id=? and plate_text=?`, [ctx.from.id, plate]);
  if (res.changes) await replyDel(ctx, `🗑 Удалён номер ${plate}.`, menuFor('cars', ctx));
  else await replyDel(ctx, `Не найден ваш номер ${plate}.`, menuFor('cars', ctx));
});

// Capture ForceReply answers
bot.on('text', async (ctx, next) => {
  if ((ctx.message.text || '').startsWith('/')) { await autoDeleteUserMessage(ctx, GROUP_TTL); return next(); }
  const p = getPending(ctx.from.id);
  if (!p) return next();
  const isReplyToPrompt = ctx.message.reply_to_message && ctx.message.reply_to_message.message_id === p.promptMsgId;
  if (!isReplyToPrompt) return next();

  const plate = normPlate(ctx.message.text);
  if (!plate || plate.length < 4) {
    clearPending(ctx.from.id);
    await replyDel(ctx, 'Номер должен содержать минимум 4 символа (латиница/цифры).', menuFor('register', ctx));
    await autoDeleteUserMessage(ctx, GROUP_TTL);
    return;
  }

  if (p.action === 'register') {
    try {
      run(`insert into car_plates (tg_id, plate_text) values (?, ?)`, [ctx.from.id, plate]);
      await replyDel(ctx, `✅ Номер ${plate} зарегистрирован за вами.`, menuFor('cars', ctx));
    } catch (e) {
      const owner = get(`select tg_id from car_plates where plate_text=?`, [plate]);
      if (owner && owner.tg_id === ctx.from.id) await replyDel(ctx, `ℹ️ Номер ${plate} уже зарегистрирован за вами.`, menuFor('cars', ctx));
      else await replyDel(ctx, `⛔ Номер ${plate} уже зарегистрирован другим игроком.`, menuFor('cars', ctx));
    }
    clearPending(ctx.from.id);
    await autoDeleteUserMessage(ctx, GROUP_TTL);
    return;
  }

  if (p.action === 'delete') {
    const res = run(`delete from car_plates where tg_id=? and plate_text=?`, [ctx.from.id, plate]);
    if (res.changes) await replyDel(ctx, `🗑 Удалён номер ${plate}.`, menuFor('cars', ctx));
    else await replyDel(ctx, `Не найден ваш номер ${plate}.`, menuFor('cars', ctx));
    clearPending(ctx.from.id);
    await autoDeleteUserMessage(ctx, GROUP_TTL);
    return;
  }

  return next();
});

// ---------- PHOTO FLOW (OCR + SCORING + SPOTTED BONUS & NOTIFY) ----------
bot.on('photo', async (ctx) => {
  try {
    const caption = ctx.message.caption || '';
    if (!hasHashtag(caption)) { await autoDeleteUserMessage(ctx, GROUP_TTL); return; }

    // upsert user
    try {
      run(`INSERT INTO users (tg_id, username, first_name, last_name) VALUES (?,?,?,?)
           ON CONFLICT(tg_id) DO UPDATE SET username=excluded.username, first_name=excluded.first_name, last_name=excluded.last_name`,
          [ctx.from.id, ctx.from.username || null, ctx.from.first_name || null, ctx.from.last_name || null]);
    } catch {}

    const spotterId = ctx.from.id;
    const photo = ctx.message.photo.slice(-1)[0];
    let plate = '';

    if (String(process.env.OCR_PROVIDER).toLowerCase() === 'external') {
      const imgUrl = await getTelegramFileUrl(ctx, photo.file_id);
      plate = await detectPlateFromUrl(imgUrl);
    }
    if (!plate) plate = normPlate(caption.match(/[A-Z0-9-]{4,}/i)?.[0] || ('PLT' + Math.floor(Math.random()*9000+1000)));

    // write submission (unique by user/game/plate)
    let added = false;
    let submission_id = null;
    try {
      const res = run(`insert into submissions (tg_id, game_id, photo_id, plate_text, is_valid, points)
                       values (?,?,?,?,?,?)`,
                      [spotterId, ACTIVE_GAME_ID, photo.file_id, plate, 1, 10]);
      added = res.changes === 1;
      submission_id = res.lastInsertRowid || null;
    } catch {}

    // Award owner bonus + notify via addon
    if (submission_id) {
      await spotted.awardSpotted({
        bot,
        plate,
        submission_id,
        submitter_tg_id: spotterId
      });
    }

    if (added) {
      await replyDel(ctx, `✅ Зачтено: ${plate} (+10)`, menuFor('home', ctx));
    } else {
      await replyDel(ctx, `⚠️ Уже находил(а) номер ${plate} — без начисления`, menuFor('home', ctx));
    }
    await autoDeleteUserMessage(ctx, PROMPT_TTL);

  } catch (e) {
    console.error(e);
    await replyDel(ctx, 'Ошибка обработки фото.', menuFor('home', ctx));
    await autoDeleteUserMessage(ctx, GROUP_TTL);
  }
});

// ---------- START ----------
bot.launch({ dropPendingUpdates: true });
console.log('Bot started');
