# FINDOLLAR background Web Push deployment

The schema migration `planner_push_payload` was applied to the existing Supabase
project on 2026-09-22. The frontend, Edge Function, and cron job are intentionally
not deployed yet. The order below prevents the frontend toggle from becoming
available before the sender exists.

1. Generate one standard VAPID key pair in a trusted local terminal. Never commit or log the private key.
2. Verify `planner_push_payload` is present in the target project's migration
   history. It is already applied to the current FINDOLLAR project; apply the
   checked-in migration only to another environment that still needs it.
3. Configure these Edge Function secrets:
   - `VAPID_PUBLIC_KEY`
   - `VAPID_PRIVATE_KEY`
   - `VAPID_SUBJECT` (`mailto:` or an HTTPS contact URL)
   - `PLANNER_CRON_SECRET` (a separate random value of at least 32 characters)
4. Deploy only `planner-reminders` with Supabase JWT verification disabled. The function authenticates every request with the independent cron secret and uses the service-role key only server-side.
5. Put the same public VAPID key in the existing Vercel project as `VITE_WEB_PUSH_PUBLIC_KEY`, then deploy the web app.
6. In Supabase Vault, create `findollar_project_url` and `findollar_planner_cron_secret`. The latter must exactly match the Edge Function's `PLANNER_CRON_SECRET`.
7. Run `scheduler/planner-reminders.sql` once and verify `cron.job` and `net._http_response` before enabling notifications on real devices.

Never put `VAPID_PRIVATE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, or `PLANNER_CRON_SECRET` in Vite/Vercel client variables. A Vite variable is public by design.

Device verification should cover Android PWA/browser, iOS/iPadOS Home Screen web apps, and supported desktop browsers. iOS/iPadOS Web Push requires an installed Home Screen web app and a permission request triggered by the user's toggle.

For SSRF safety, subscription endpoints are accepted only for reviewed Google,
Mozilla, Apple (`*.push.apple.com`), and Microsoft push-service domains. This
does not create platform-specific notification systems: all use the same Web
Push protocol. A browser using another service will remain OFF until its
service origin is reviewed and added to both the database validator and sender.
