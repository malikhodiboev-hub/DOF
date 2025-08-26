
import { validateInitData } from './validateInitData.js';
export function requireInitData(req, res, next) {
  const initData = req.header('X-Telegram-Init-Data') || '';
  const ok = validateInitData(initData, process.env.BOT_TOKEN, 86400);
  if (!ok.ok) return res.status(401).json({ ok: false, error: ok.error });
  req.tg = ok.data;
  try { req.user = req.tg.user ? JSON.parse(req.tg.user) : null; } catch { req.user = null; }
  next();
}
