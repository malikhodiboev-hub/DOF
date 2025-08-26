// bot_addons/racer-bot-addon.js
import * as db from '../db/db.js';

export default async function installRacerDM(bot){
  const base = process.env.PUBLIC_BASE_URL || 'https://example.com';

  bot.action(/^pvp_decline:(\d+)$/, async (ctx)=>{
    try{
      const id = Number(ctx.match[1]);
      const row = db.get('SELECT * FROM racer_challenges WHERE id=?', [id]);
      if (!row) return ctx.answerCbQuery('Нет вызова');
      if (row.to_tg !== ctx.from.id || row.status !== 'pending') return ctx.answerCbQuery('Нельзя');
      db.run('UPDATE racer_challenges SET status=\'declined\' WHERE id=?', [id]);
      try{ await ctx.editMessageReplyMarkup(undefined); }catch{}
      await ctx.answerCbQuery('Отказано');
      if (row.from_tg) {
        try { await ctx.telegram.sendMessage(row.from_tg, `❌ Вызов #${id} отклонён игроком ${ctx.from.id}`); } catch{}
      }
    }catch(e){ try{ await ctx.answerCbQuery('Ошибка'); }catch{} }
  });

  setInterval(async () => {
    try{
      const rows = db.query("SELECT id, from_tg, to_tg FROM racer_challenges WHERE status='pending' AND notified=0 ORDER BY id ASC LIMIT 20");
      for (const r of rows){
        const url = `${base}/webapp/racer/?chal=${r.id}`;
        const kb = {
          inline_keyboard: [
            [{ text:'✅ Принять в WebApp', web_app:{ url } }],
            [{ text:'Отказать', callback_data:`pvp_decline:${r.id}` }]
          ]
        };
        try{
          await bot.telegram.sendMessage(r.to_tg, `🤜 Вам вызов на дуэль от игрока ${r.from_tg} (#${r.id})!`, { reply_markup: kb });
          db.run('UPDATE racer_challenges SET notified=1 WHERE id=?', [r.id]);
        }catch(e){}
      }
    }catch{}
  }, 5000);
}
