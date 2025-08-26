
// Simple admin SPA
const $ = (s, el=document)=> el.querySelector(s);
const $$ = (s, el=document)=> Array.from(el.querySelectorAll(s));
const api = (path, opts={}) => {
  const headers = opts.headers || {};
  const initData = window.Telegram?.WebApp?.initData || '';
  if (initData) headers['X-Telegram-Init-Data'] = initData;
  return fetch(path, { ...opts, headers });
};
const json = async (r)=> { try{ return await r.json(); } catch { return {ok:false}; } };

function setView(id){
  ['dash','lb','users','actions'].forEach(x=>document.getElementById(x).classList.toggle('hidden', x!==id));
  $$('.menu a').forEach(a=> a.classList.toggle('active', a.dataset.target===id));
}

async function loadStats(){
  const r = await api('/api/admin/summary'); const d = await json(r);
  if (d?.ok){
    $('#stat-users').textContent = d.users;
    $('#stat-subm').textContent = d.submissions;
    $('#stat-uniq').textContent = d.unique_plates;
    $('#stat-cars').textContent = d.cars;
  }
}
async function loadLB(){
  const r = await api('/api/admin/leaderboard?limit=50'); const d = await json(r);
  const body = $('#lb-body');
  if (d?.ok && Array.isArray(d.items)){
    body.innerHTML = d.items.map((r,i)=>{
      const name = r.first_name || (r.username ? '@'+r.username : ('ID '+r.tg_id));
      return `<tr><td>${i+1}</td><td>${name}</td><td>${r.total_points}</td><td>${r.unique_plates}</td></tr>`;
    }).join('');
  } else body.innerHTML = '<tr><td colspan="4">Нет данных</td></tr>';
}
async function searchUsers(){
  const q = $('#user-q').value.trim();
  const r = await api('/api/admin/users?q='+encodeURIComponent(q)); const d = await json(r);
  const body = $('#user-body');
  if (d?.ok && Array.isArray(d.items) && d.items.length){
    body.innerHTML = d.items.map(u=>{
      const name = u.first_name || (u.username ? '@'+u.username : ('ID '+u.tg_id));
      const cars = (u.cars||[]).slice(0,3).join(', ') + (u.cars && u.cars.length>3 ? '…' : '');
      return `<tr>
        <td>${name}<div class="muted">${u.tg_id}</div></td>
        <td>${u.total_points}</td>
        <td>${u.unique_plates}</td>
        <td>${cars || '—'}</td>
        <td><span class="badge">+ бонус</span></td>
      </tr>`;
    }).join('');
  } else body.innerHTML = '<tr><td colspan="5">Ничего не найдено</td></tr>';
}
async function addBonus(){
  const tg = Number($('#bonus-tg').value.trim()); const amt = Number($('#bonus-amt').value.trim()); const reason = $('#bonus-reason').value.trim();
  if (!tg || !amt) return alert('Укажи tg_id и сумму');
  const r = await api('/api/admin/bonus', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ tg_id: tg, amount: amt, reason }) });
  const d = await json(r);
  if (d?.ok){ alert('Готово'); $('#bonus-amt').value=''; $('#bonus-reason').value=''; } else alert('Не удалось начислить');
}

document.addEventListener('DOMContentLoaded', ()=>{
  $$('.menu a').forEach(a=> a.addEventListener('click', (e)=>{ e.preventDefault(); setView(a.dataset.target); if(a.dataset.target==='lb') loadLB(); }));
  $('#btn-user-search')?.addEventListener('click', searchUsers);
  $('#btn-bonus')?.addEventListener('click', addBonus);
  setView('dash'); loadStats();
});
