-- ===========================================================================
-- cron.sql — schedule the daily Workspace activity sync.
-- Run once in the Supabase SQL editor AFTER the edge function is deployed.
-- Uses pg_cron (scheduler) + pg_net (HTTP from Postgres) + Vault (secrets).
-- ===========================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Store secrets in Vault rather than inline. Set these once (replace values):
--   select vault.create_secret('https://wenhudcyvlhilpgazylg.supabase.co/functions/v1/sync-workspace-activity', 'sync_url');
--   select vault.create_secret('YOUR_SYNC_SECRET', 'sync_secret');
--   select vault.create_secret('YOUR_SUPABASE_ANON_OR_SERVICE_KEY', 'sync_bearer');

-- Run at 02:30 UTC daily (08:00 IST) so yesterday's audit logs have settled.
select cron.schedule(
  'hoppity-workspace-sync',
  '30 2 * * *',
  $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'sync_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'sync_bearer'),
      'x-sync-key', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- To inspect or remove:
--   select * from cron.job;
--   select cron.unschedule('hoppity-workspace-sync');
