alter table public.ot_activities add column unit_size numeric not null default 1 check(unit_size>0);
