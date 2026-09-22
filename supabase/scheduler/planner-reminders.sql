-- Run only after planner-reminders is deployed and these Vault secrets exist:
--   findollar_project_url   = https://<project-ref>.supabase.co
--   findollar_planner_cron_secret = the same 32+ character value stored as
--                                    PLANNER_CRON_SECRET for the Edge Function
-- This file deliberately contains no real URL, token, VAPID key, or password.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'findollar-planner-reminders-v1',
  '* * * * *',
  $job$
    select net.http_post(
      url := (
        select decrypted_secret from vault.decrypted_secrets
        where name = 'findollar_project_url'
      ) || '/functions/v1/planner-reminders',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          select decrypted_secret from vault.decrypted_secrets
          where name = 'findollar_planner_cron_secret'
        )
      ),
      body := jsonb_build_object('scheduledAt', now()),
      timeout_milliseconds := 45000
    ) as request_id;
  $job$
);
