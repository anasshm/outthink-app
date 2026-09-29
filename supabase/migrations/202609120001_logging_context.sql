-- Only structured completion references are replayed to routine chat, never
-- raw messages, journal text, scores, or reflection responses.
alter table public.ot_messages add column logging_context jsonb;
