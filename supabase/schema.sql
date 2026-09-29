create extension if not exists vector with schema extensions;

create table if not exists public.knowledge_chunks (
  id text primary key,
  title text not null,
  content text not null,
  category text not null,
  places text[] not null default '{}',
  tags text[] not null default '{}',
  source_type text not null check (source_type in ('official', 'user_experience', 'product_rule', 'editorial')),
  source_date date,
  source_url text,
  metadata jsonb not null default '{}'::jsonb,
  embedding extensions.vector,
  embedding_model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.trip_sessions (
  id text primary key,
  trip_context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.chat_messages (
  id bigint generated always as identity primary key,
  session_id text not null references public.trip_sessions(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  retrieval_refs text[] not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists knowledge_chunks_category_idx on public.knowledge_chunks(category);
create index if not exists knowledge_chunks_places_idx on public.knowledge_chunks using gin(places);
create index if not exists chat_messages_session_idx on public.chat_messages(session_id, created_at);

create or replace function public.match_knowledge(
  query_embedding extensions.vector,
  query_model text,
  match_threshold float default 0.12,
  match_count int default 6
)
returns table (
  id text,
  title text,
  content text,
  category text,
  places text[],
  tags text[],
  source_type text,
  source_date date,
  source_url text,
  metadata jsonb,
  similarity float
)
language sql
stable
as $$
  select
    kc.id,
    kc.title,
    kc.content,
    kc.category,
    kc.places,
    kc.tags,
    kc.source_type,
    kc.source_date,
    kc.source_url,
    kc.metadata,
    1 - (kc.embedding <=> query_embedding) as similarity
  from public.knowledge_chunks kc
  where kc.embedding is not null
    and kc.embedding_model = query_model
    and 1 - (kc.embedding <=> query_embedding) >= match_threshold
  order by kc.embedding <=> query_embedding
  limit least(match_count, 20);
$$;

alter table public.knowledge_chunks enable row level security;
alter table public.trip_sessions enable row level security;
alter table public.chat_messages enable row level security;

revoke all on public.knowledge_chunks from anon, authenticated;
revoke all on public.trip_sessions from anon, authenticated;
revoke all on public.chat_messages from anon, authenticated;
revoke all on function public.match_knowledge(extensions.vector, text, float, int) from anon, authenticated;

grant all on public.knowledge_chunks to service_role;
grant all on public.trip_sessions to service_role;
grant all on public.chat_messages to service_role;
grant usage, select on sequence public.chat_messages_id_seq to service_role;
grant execute on function public.match_knowledge(extensions.vector, text, float, int) to service_role;
