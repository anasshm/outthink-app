-- Activity discussion summaries only; never import historical chat or journal text.
alter table public.ot_messages add column discussion_context jsonb;
