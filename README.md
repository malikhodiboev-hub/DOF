# TG Plate Game (SQLite, External OCR Ready)
- WebApp + API (Express)
- Telegram Bot (Telegraf)
- SQLite (better-sqlite3)
- Admin UI (/webapp/admin/) with bonus + leaderboard
- Pretty UI with dark/light via Telegram theme
- OCR: Plate Recognizer (upload_url)

## Quick start
npm i
cp .env.example .env   # fill BOT_TOKEN, PUBLIC_BASE_URL, OCR_EXTERNAL_API_KEY
npm run db:apply
npm run dev:web
npm run dev:bot

## Admin
Use /admin in the bot. Add your ID to ADMIN_TG_IDS in .env.
