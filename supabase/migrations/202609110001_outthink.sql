create table public.ot_meta (id int primary key check(id=1), revision bigint not null default 0, settings jsonb not null, clarification jsonb);
insert into public.ot_meta(id,revision,settings) values(1,0,'{"timezone":"UTC","cutoff":8,"targets":{"mental":{"today":100,"seven":700,"thirty":3000},"physical":{"today":100,"seven":700,"thirty":3000},"work":{"today":100,"seven":700,"thirty":3000},"social":{"today":100,"seven":700,"thirty":3000}},"workPenalty":{"enabled":true,"afterMinutes":240,"perHour":{"mental":-10,"social":-10}}}');
create table public.ot_activities (
 id uuid primary key, name text not null, description text not null default '',
 xp jsonb not null, unit text not null check(unit in ('minute','hour','completion')),
 default_quantity numeric not null check(default_quantity>0), preferred_frequency jsonb,
 note text not null default '', must_do boolean not null default false,
 tracks_work boolean not null default false, archived boolean not null default false,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.ot_logs (
 id uuid primary key, activity_id uuid not null references public.ot_activities(id), day date not null,
 label text not null, quantity numeric not null check(quantity>0), xp jsonb not null,
 work_minutes numeric not null default 0, penalty_rule jsonb not null,
 done boolean not null default true, created_at timestamptz not null default now()
);
create index ot_logs_day on public.ot_logs(day);
create table public.ot_journal (
 id uuid primary key, day date not null, text text not null, scores jsonb not null default '{}',
 period text not null default 'day', created_at timestamptz not null default now()
);
create index ot_journal_day on public.ot_journal(day);
create table public.ot_messages (
 id uuid primary key, day date not null, role text not null check(role in ('user','assistant')),
 text text not null, mode text not null, created_at timestamptz not null default now()
);
create table public.ot_goals (
 id uuid primary key, title text not null, note text not null default '', areas jsonb not null default '[]',
 activity_ids jsonb not null default '[]', until_day date, active boolean not null default true,
 created_at timestamptz not null default now()
);
create table public.ot_proposals (
 id uuid primary key, title text not null, actions jsonb not null, status text not null default 'pending',
 created_at timestamptz not null default now()
);
create table public.ot_receipts (id uuid primary key, result jsonb not null, created_at timestamptz not null default now());
create table public.ot_sessions (token_hash text primary key, expires_at timestamptz not null);
create table public.ot_limits (key text primary key, hits int not null, until_at timestamptz not null);

-- No data or functions are accessible with a browser publishable/anon key.
do $$ declare t text; begin
 foreach t in array array['ot_meta','ot_activities','ot_logs','ot_journal','ot_messages','ot_goals','ot_proposals','ot_receipts','ot_sessions','ot_limits'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon, authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;

-- A single personal workspace revision makes multi-device edits transactional.
-- Only the server can call this function, after validating each individual write.
create function public.ot_apply(expected_revision bigint, request_id uuid, writes jsonb, response jsonb)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare current_rev bigint; existing jsonb; pair record; row_data jsonb; colnames text; updates text; allowed text[] := array['ot_activities','ot_logs','ot_journal','ot_messages','ot_goals','ot_proposals'];
begin
 select revision into current_rev from ot_meta where id=1 for update;
 select result into existing from ot_receipts where id=request_id;
 if found then return existing; end if;
 if current_rev <> expected_revision then raise exception 'OUTTHINK_CONFLICT' using errcode='40001'; end if;
 for pair in select * from jsonb_each(writes) loop
  if pair.key='settings' then update ot_meta set settings=pair.value where id=1;
  elsif pair.key='clarification' then update ot_meta set clarification=pair.value where id=1;
  else
   if not(pair.key=any(allowed)) then raise exception 'Invalid table'; end if;
   select string_agg(quote_ident(column_name),',' order by ordinal_position),
          string_agg(format('%I=excluded.%I',column_name,column_name),',' order by ordinal_position) filter(where column_name <> 'id')
   into colnames,updates from information_schema.columns where table_schema='public' and table_name=pair.key;
   for row_data in select value from jsonb_array_elements(pair.value) loop
    execute format('insert into public.%1$I (%2$s) select %2$s from jsonb_populate_record(null::public.%1$I,$1) on conflict(id) do update set %3$s',pair.key,colnames,updates) using row_data;
   end loop;
  end if;
 end loop;
 update ot_meta set revision=revision+1 where id=1;
 insert into ot_receipts(id,result) values(request_id,response);
 return response;
end $$;
revoke all on function public.ot_apply(bigint,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.ot_apply(bigint,uuid,jsonb,jsonb) to service_role;

create function public.ot_rate_limit(bucket text, max_hits int, window_seconds int)
returns boolean language plpgsql security invoker set search_path=public as $$
declare n int; begin
 insert into ot_limits as l(key,hits,until_at) values(bucket,1,now()+make_interval(secs=>window_seconds))
 on conflict(key) do update set hits=case when l.until_at<=now() then 1 else l.hits+1 end,
 until_at=case when l.until_at<=now() then now()+make_interval(secs=>window_seconds) else l.until_at end
 returning hits into n;
 return n<=max_hits;
end $$;
revoke all on function public.ot_rate_limit(text,int,int) from public,anon,authenticated;
grant execute on function public.ot_rate_limit(text,int,int) to service_role;
