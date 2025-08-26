
// Telegram WebApp theme + profile + actions
(function(){
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const setTheme = (t)=> document.documentElement.setAttribute('data-theme', t === 'dark' ? 'dark' : 'light');
  try{
    if (window.Telegram && Telegram.WebApp) {
      Telegram.WebApp.ready();
      Telegram.WebApp.expand();
      setTheme(Telegram.WebApp.colorScheme || (prefersDark ? 'dark':'light'));
      Telegram.WebApp.onEvent('themeChanged', ()=> setTheme(Telegram.WebApp.colorScheme));
    } else {
      setTheme(prefersDark ? 'dark':'light');
    }
  }catch(e){ setTheme(prefersDark ? 'dark':'light'); }
})();

const metaBot = document.querySelector('meta[name="bot-username"]');
const BOT_USERNAME = metaBot?.content || '';

const $ = (sel, el=document)=> el.querySelector(sel);
const $$ = (sel, el=document)=> Array.from(el.querySelectorAll(sel));
const api = {
  rules: ()=> fetch('/api/rules').then(r=>r.json()).catch(()=>({ok:false})),
  leaderboard: ()=> fetch('/api/leaderboard').then(r=>r.json()).catch(()=>({ok:false})),
  me: ()=> {
    try{
      const initData = (window.Telegram?.WebApp?.initData || '');
      if(!initData) return Promise.resolve({ ok:false, needInitData:true });
      return fetch('/api/me',{ headers:{ 'X-Telegram-Init-Data': initData }}).then(r=>r.json());
    }catch(e){ return Promise.resolve({ ok:false }); }
  }
};

function setAvatarFrom(tgUser){
  const el = $('.avatar');
  if (!el) return;
  const name = (tgUser?.first_name || '') + ' ' + (tgUser?.last_name || '');
  const initials = (tgUser?.first_name?.[0] || '?') + (tgUser?.last_name?.[0] || '').toUpperCase();
  el.textContent = initials.trim();
  if (tgUser?.photo_url) {
    el.textContent = '';
    el.style.backgroundImage = `url("${tgUser.photo_url}")`;
    el.style.backgroundSize = 'cover';
  }
  $('.hero-title').textContent = tgUser?.first_name ? `Привет, ${tgUser.first_name}!` : 'Plates Game';
  $('.hero-sub .me-username').textContent = (tgUser?.username ? '@'+tgUser.username : 'гость');
}

function quickScroll(id){
  const el = document.getElementById(id);
  if(!el) return;
  el.scrollIntoView({ behavior:'smooth', block:'start' });
  el.classList.add('pulse');
  setTimeout(()=> el.classList.remove('pulse'), 900);
}

function openBot(){
  if (window.Telegram?.WebApp?.openTelegramLink && BOT_USERNAME){
    Telegram.WebApp.openTelegramLink(`https://t.me/${BOT_USERNAME}`);
  } else if (BOT_USERNAME) {
    window.location.href = `tg://resolve?domain=${BOT_USERNAME}`;
  } else {
    alert('Откройте страницу из бота, чтобы все функции работали корректно.');
  }
}

// hydrate
async function hydrate(){
  // avatar/title
  const raw = window.Telegram?.WebApp?.initDataUnsafe?.user || null;
  if (raw) setAvatarFrom(raw);

  // rules
  const rules = await api.rules();
  if (rules?.ok) { $('#rules .content').innerText = rules.text || 'Правила обновятся позже.'; }

  // leaderboard
  const tbody = $('#leaderboard tbody');
  tbody.innerHTML = '<tr><td class="skeleton" colspan="4">&nbsp;</td></tr>';
  const lb = await api.leaderboard();
  if (lb?.ok && Array.isArray(lb.leaderboard) && lb.leaderboard.length){
    tbody.innerHTML = lb.leaderboard.map((r,i)=>{
      const name = r.first_name || (r.username ? '@'+r.username : ('ID '+r.tg_id));
      return `<tr><td>${i+1}</td><td>${name}</td><td>${r.total_points}</td><td>${r.unique_plates}</td></tr>`;
    }).join('');
  } else {
    $('#leaderboard').classList.add('hidden');
    $('#leaderboard-empty').classList.remove('hidden');
  }

  // me
  const me = await api.me();
  if (me?.ok && me.me) {
    $('.kpi .points').textContent = me.me.total_points ?? 0;
    $('.kpi .plates').textContent = me.me.unique_plates ?? 0;
    if (Array.isArray(me.my_cars)) { $('.kpi .cars').textContent = me.my_cars.length; }
  } else {
    $('#cta-open-bot').classList.remove('hidden');
  }
}

document.addEventListener('DOMContentLoaded', ()=>{
  hydrate();
  // quick chips
  $('#chip-cars')?.addEventListener('click', ()=> quickScroll('me'));
  $('#chip-top')?.addEventListener('click', ()=> quickScroll('leaderboard'));
  $('#chip-rules')?.addEventListener('click', ()=> quickScroll('rules'));
  $('#cta-open-bot')?.addEventListener('click', openBot);
});
