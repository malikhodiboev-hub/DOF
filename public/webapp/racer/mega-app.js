// mega-app.js — hotfix v1: robust tg_id + оставляем остальной код без библиотек
const $ = (q)=>document.querySelector(q);
const $$ = (q)=>Array.from(document.querySelectorAll(q));

function getTgId(){
  // 1) Telegram WebApp
  const tgid = window.Telegram?.WebApp?.initDataUnsafe?.user?.id;
  if (tgid) { localStorage.setItem('tg_id', String(tgid)); return tgid; }
  // 2) URL param ?tg_id or ?tg
  const url = new URL(location.href);
  const p = url.searchParams.get('tg_id') || url.searchParams.get('tg');
  if (p){ localStorage.setItem('tg_id', p); return Number(p); }
  // 3) localStorage (from previous run)
  const ls = localStorage.getItem('tg_id');
  return ls ? Number(ls) : 0;
}
const TG_ID = getTgId();

function api(path, opt={}){
  const url = new URL(path, location.origin);
  if (TG_ID) url.searchParams.set('tg_id', TG_ID);
  return fetch(url.toString(), {
    method: opt.method || 'GET',
    headers: { 'Content-Type':'application/json' },
    body: opt.body ? JSON.stringify(opt.body) : undefined,
  }).then(r => r.json());
}

// Если открыли НЕ из Telegram и TG_ID не определён — покажем подсказку
(function maybeBanner(){
  if (TG_ID) return;
  const el = document.createElement('div');
  el.style.cssText = 'position:sticky;top:0;z-index:50;padding:10px;background:#ef4444;color:#fff;border-radius:10px;margin:10px 0;text-align:center';
  el.textContent = 'Откройте игру из Telegram (кнопка WebApp) или добавьте ?tg_id=ВАШ_ID в URL.';
  document.body.prepend(el);
})();

// === ниже оставьте ваш актуальный игровой код v1.3 (рендер, гонка, магазин, pvp) ===
// если у вас уже есть mega-app.js с логикой — просто сохраните вышеописанные функции
// getTgId() и api(), а остальной код не трогайте.
