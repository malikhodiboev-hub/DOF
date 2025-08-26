
// Theme + Telegram init
(function(){
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const setTheme = (t)=> document.documentElement.setAttribute('data-theme', t === 'dark' ? 'dark' : 'light');
  try{
    if (window.Telegram && Telegram.WebApp) {
      Telegram.WebApp.ready(); Telegram.WebApp.expand();
      setTheme(Telegram.WebApp.colorScheme || (prefersDark ? 'dark':'light'));
      Telegram.WebApp.onEvent('themeChanged', ()=> setTheme(Telegram.WebApp.colorScheme));
    } else setTheme(prefersDark ? 'dark':'light');
  }catch(e){ setTheme(prefersDark ? 'dark':'light'); }
})();

const BOT_USERNAME = document.querySelector('meta[name="bot-username"]')?.content || '';
const $ = (s, el=document)=> el.querySelector(s);
const $$ = (s, el=document)=> Array.from(el.querySelectorAll(s));
const api = (path, opts={}) => {
  const headers = opts.headers || {};
  const initData = window.Telegram?.WebApp?.initData || '';
  if (initData) headers['X-Telegram-Init-Data'] = initData;
  return fetch(path, { ...opts, headers });
};
const json = async (r)=> { try{ return await r.json(); } catch { return {ok:false}; } };

function setActiveTab(id){
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.target === id));
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior:'smooth', block:'start' });
}

function normPlate(s){ return String(s||'').toUpperCase().replace(/[^A-Z0-9]/g,''); }

function renderCars(cars){
  const wrap = $('#cars-wrap'); wrap.innerHTML = '';
  if (!cars || !cars.length) { wrap.innerHTML = '<div class="muted">Нет зарегистрированных номеров</div>'; return; }
  cars.forEach(p => {
    const chip = document.createElement('div'); chip.className='car-chip';
    chip.innerHTML = `<span>${p}</span> <span class="del" title="Удалить" data-plate="${p}">✖</span>`;
    wrap.appendChild(chip);
  });
  wrap.addEventListener('click', async (e)=>{
    const del = e.target.closest('.del'); if (!del) return;
    const plate = del.dataset.plate;
    const r = await api('/api/cars/delete', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ plate }) });
    const data = await json(r);
    if (data?.ok) hydrateMe(); else alert('Не удалось удалить номер');
  }, { once:true });
}

async function hydrateRules(){
  const r = await api('/api/rules'); const data = await json(r);
  if (data?.ok){
    $('#rules .content').innerText = data.text || '';
    $('#howto .content').innerText = data.howto || '';
  }
}

async function hydrateLeaderboard(){
  const tbody = $('#leaderboard tbody'); tbody.innerHTML = '<tr><td colspan="4">Загрузка…</td></tr>';
  const r = await api('/api/leaderboard'); const data = await json(r);
  if (data?.ok && Array.isArray(data.leaderboard) && data.leaderboard.length){
    tbody.innerHTML = data.leaderboard.map((row,i)=>{
      const name = row.first_name || (row.username ? '@'+row.username : ('ID '+row.tg_id));
      return `<tr><td>${i+1}</td><td>${name}</td><td>${row.total_points}</td><td>${row.unique_plates}</td></tr>`;
    }).join('');
  } else { $('#leaderboard').classList.add('hidden'); $('#leaderboard-empty').classList.remove('hidden'); }
}

async function hydrateMe(){
  const r = await api('/api/me'); const data = await json(r);
  if (data?.ok && data.me){
    $('.hero-title').textContent = data.me.first_name ? `Привет, ${data.me.first_name}!` : 'Plates Game';
    $('.me-username') && ($('.me-username').textContent = (data.me.username ? '@'+data.me.username : 'гость'));
    renderCars(data.my_cars || []);
  } else { $('#cta-open-bot')?.classList.remove('hidden'); }
}

function setAvatarWithFallback(name) {
  const img = document.getElementById('avatar');
  if (!img) return;

  const user = window.Telegram?.WebApp?.initDataUnsafe?.user;
  const init = window.Telegram?.WebApp?.initData || '';

  const fallbackSVG = encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='96' height='96'>
       <rect width='100%' height='100%' fill='#e5e7eb'/>
       <text x='50%' y='54%' dominant-baseline='middle' text-anchor='middle' font-size='36' fill='#6b7280' font-family='system-ui,Segoe UI,Roboto,sans-serif'>
         ${(name?.[0] || '?').toUpperCase()}
       </text>
     </svg>`
  );

  // 1) если Telegram дал прямую ссылку — используем её
  if (user?.photo_url) {
    img.src = user.photo_url;
    img.onerror = () => { img.src = `/api/me/avatar?init=${encodeURIComponent(init)}&ts=${Date.now()}`; };
    return;
  }

  // 2) иначе — наш прокси (передаём init как query-параметр)
  img.src = `/api/me/avatar?init=${encodeURIComponent(init)}&ts=${Date.now()}`;
  img.onerror = () => { img.src = `data:image/svg+xml;charset=utf-8,${fallbackSVG}`; };
}

// после получения /api/me:
const name = j.me?.first_name || j.me?.username || ('ID ' + j.me?.tg_id);
document.getElementById('displayName').textContent = name;
setAvatarWithFallback(name);


async function addCar(){
  const input = $('#new-plate'); const plate = normPlate(input.value);
  if (!plate || plate.length < 4){ alert('Номер должен содержать минимум 4 символа (латиница/цифры).'); return; }
  const r = await api('/api/cars/add', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ plate }) });
  const data = await json(r);
  if (data?.ok){ input.value=''; hydrateMe(); } else { alert(data?.error || 'Не удалось добавить номер'); }
}

document.addEventListener('DOMContentLoaded', ()=>{
  hydrateRules(); hydrateLeaderboard(); hydrateMe();
  $('#btn-add-plate')?.addEventListener('click', addCar);
  $$('.tab').forEach(t => t.addEventListener('click', ()=> setActiveTab(t.dataset.target)));
});
