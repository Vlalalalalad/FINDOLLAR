-- The planner-reminders Edge Function uses the built-in service_role key.
-- This project had table privileges for service_role, but schema USAGE had
-- previously been revoked, which blocked PostgREST before RLS/table checks.
grant usage on schema public to service_role;
