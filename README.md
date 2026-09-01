# LeadStream

Nationwide Reddit lead monitor — garage door category. Scans Reddit sitewide + dedicated
subs, AI-classifies each post (service intent / DIY / noise + location + 0-100 score),
stores leads in Supabase, and push-notifies the phone app on hot leads.

## Setup

1. `npm install`
2. Copy `.env.local.example` → `.env.local` and fill in:
   - Reddit: create a **script** app at reddit.com/prefs/apps → client id + secret
   - Anthropic API key
   - Supabase: new project → run `supabase/schema.sql` in SQL editor → copy URL + service role key
   - `APP_SECRET` / `CRON_SECRET`: any long random strings
3. Test one scan: `npm run scan`
4. Run continuously (local): `npm run autopilot`
5. Dashboard: `npm run dev` → localhost:3000

## Deploy (Vercel)

`vercel.json` defines an hourly cron hitting `/api/scan` (Vercel sends
`Authorization: Bearer $CRON_SECRET` automatically). Set all env vars in Vercel.

## API

- `GET/POST /api/scan` — run a scan (Bearer CRON_SECRET or x-app-secret)
- `GET /api/leads` — latest 200 non-noise leads (x-app-secret)
- `POST /api/reply {id}` — generate AI reply draft for a lead (x-app-secret)
- `POST /api/devices {token,label}` — register Expo push token (x-app-secret)
