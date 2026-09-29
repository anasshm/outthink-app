alter table public.ot_proposals add column preview jsonb not null default '{}';
alter table public.ot_messages add column suggestions jsonb not null default '[]';
