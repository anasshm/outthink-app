-- Nullable additions keep earlier deployments and historical entries valid.
alter table public.ot_activities add column daily_bonus jsonb;
alter table public.ot_logs add column reward_rule jsonb;

-- ot_apply discovers columns dynamically; existing RLS and service-role-only
-- permissions also cover these fields. No user data or rates change here.
