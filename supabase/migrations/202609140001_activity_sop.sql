-- HOW instructions are optional. Existing activities and their histories stay intact.
alter table public.ot_activities add column sop text not null default '';
alter table public.ot_logs add column sop_reminded_at timestamptz;

