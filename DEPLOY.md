# MEDTRACK — setup & deployment

## 1. Supabase
1. Create a project. Run `supabase/migrations/0001_init.sql` in the SQL editor (or `supabase db push`).
2. **Auth → Providers → Google**: enable, paste a Google OAuth client ID/secret (Google Cloud Console → OAuth client, redirect URI = the callback URL Supabase shows).
3. **Auth → URL configuration**: set Site URL and add your production URL (and `http://localhost:5173`) to redirect URLs.
4. Settings → API: copy the project URL and **anon** key. Never use the service-role key in the frontend.

## 2. Frontend
```
cp .env.example .env   # fill VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
npm ci && npm test && npm run build
```
Deploy `dist/` to Vercel/Netlify/Cloudflare Pages (SPA rewrite is already in `vercel.json` / `public/_redirects`) and set the same two env vars there.
Install as a PWA from the browser menu (HTTPS required).

## 3. Background push (optional)
```
npx web-push generate-vapid-keys
```
- Put the public key in `VITE_VAPID_PUBLIC_KEY` and rebuild.
- `supabase secrets set VAPID_PUBLIC_KEY=… VAPID_PRIVATE_KEY=… VAPID_SUBJECT=mailto:you@example.com CRON_SECRET=<random>`
- `supabase functions deploy send-reminders --no-verify-jwt`
- Schedule it every minute (pg_cron + pg_net) with header `Authorization: Bearer <CRON_SECRET>`.
Without these, reminders still fire while MEDTRACK is open, and Settings says so honestly.

## 4. Course outline
The outline was not supplied, so every course starts with **0 tracked topics**. Paste it per course (Courses → course → Import outline) or fill `src/data/courseOutline.ts` before a new account is created.

## Tests
`npm test` — engine rules (cycle progression, progress math) and the sync/conflict layer against an in-memory fake server.
`VITE_DEV_LOCAL_USER=1 npm run dev` runs a dev-only local mode with no auth/sync (stripped from production builds).
