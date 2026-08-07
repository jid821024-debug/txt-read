-- 이어읽기 개인용 TXT·EPUB 뷰어 데이터베이스
-- Supabase Dashboard > SQL Editor에서 전체 실행하세요.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  original_filename text not null,
  encoding text not null default 'utf-8' check (encoding in ('utf-8', 'euc-kr')),
  content_hash text not null,
  file_size bigint not null default 0 check (file_size >= 0),
  total_characters integer not null default 0 check (total_characters >= 0),
  total_blocks integer not null default 0 check (total_blocks >= 0),
  file_type text not null default 'txt' check (file_type in ('txt', 'epub')),
  author text,
  cover_data_url text,
  toc jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, content_hash)
);

create table if not exists public.document_blocks (
  document_id uuid not null,
  user_id uuid not null default auth.uid(),
  block_index integer not null check (block_index >= 0),
  char_start integer not null default 0 check (char_start >= 0),
  content text not null,
  chapter_index integer not null default 0 check (chapter_index >= 0),
  chapter_title text,
  source_href text,
  block_kind text not null default 'paragraph' check (block_kind in ('paragraph', 'heading', 'chapter')),
  created_at timestamptz not null default now(),
  primary key (document_id, block_index),
  constraint document_blocks_document_owner_fk
    foreign key (document_id, user_id)
    references public.documents(id, user_id)
    on delete cascade
);

-- v1/v2에서 이 파일을 다시 실행해도 EPUB용 열이 추가됩니다.
alter table public.documents
  add column if not exists file_type text not null default 'txt',
  add column if not exists author text,
  add column if not exists cover_data_url text,
  add column if not exists toc jsonb not null default '[]'::jsonb;

alter table public.document_blocks
  add column if not exists chapter_index integer not null default 0,
  add column if not exists chapter_title text,
  add column if not exists source_href text,
  add column if not exists block_kind text not null default 'paragraph';

create table if not exists public.reading_progress (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  document_id uuid not null,
  block_index integer not null default 0 check (block_index >= 0),
  character_offset integer not null default 0 check (character_offset >= 0),
  progress_percent numeric(6,3) not null default 0 check (progress_percent between 0 and 100),
  device_id text,
  updated_at timestamptz not null default now(),
  primary key (user_id, document_id),
  constraint reading_progress_document_owner_fk
    foreign key (document_id, user_id)
    references public.documents(id, user_id)
    on delete cascade
);

create table if not exists public.reader_settings (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  font_size integer not null default 20 check (font_size between 12 and 40),
  line_height numeric(3,2) not null default 1.80 check (line_height between 1.20 and 2.80),
  content_width integer not null default 760 check (content_width between 480 and 1400),
  theme text not null default 'system' check (theme in ('system', 'light', 'dark', 'sepia')),
  screen_wake_lock boolean not null default false,
  updated_at timestamptz not null default now()
);

create index if not exists document_blocks_owner_document_idx
  on public.document_blocks(user_id, document_id, block_index);

create index if not exists documents_owner_updated_idx
  on public.documents(user_id, updated_at desc);

create index if not exists document_blocks_chapter_idx
  on public.document_blocks(user_id, document_id, chapter_index, block_index);

drop trigger if exists documents_set_updated_at on public.documents;
create trigger documents_set_updated_at
before update on public.documents
for each row execute function public.set_updated_at();

drop trigger if exists reading_progress_set_updated_at on public.reading_progress;
create trigger reading_progress_set_updated_at
before update on public.reading_progress
for each row execute function public.set_updated_at();

drop trigger if exists reader_settings_set_updated_at on public.reader_settings;
create trigger reader_settings_set_updated_at
before update on public.reader_settings
for each row execute function public.set_updated_at();

alter table public.documents enable row level security;
alter table public.document_blocks enable row level security;
alter table public.reading_progress enable row level security;
alter table public.reader_settings enable row level security;

-- 재실행할 때 정책 중복 오류가 발생하지 않도록 먼저 삭제합니다.
drop policy if exists "documents_select_own" on public.documents;
drop policy if exists "documents_insert_own" on public.documents;
drop policy if exists "documents_update_own" on public.documents;
drop policy if exists "documents_delete_own" on public.documents;

create policy "documents_select_own"
on public.documents for select to authenticated
using ((select auth.uid()) = user_id);

create policy "documents_insert_own"
on public.documents for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "documents_update_own"
on public.documents for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "documents_delete_own"
on public.documents for delete to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "document_blocks_select_own" on public.document_blocks;
drop policy if exists "document_blocks_insert_own" on public.document_blocks;
drop policy if exists "document_blocks_update_own" on public.document_blocks;
drop policy if exists "document_blocks_delete_own" on public.document_blocks;

create policy "document_blocks_select_own"
on public.document_blocks for select to authenticated
using ((select auth.uid()) = user_id);

create policy "document_blocks_insert_own"
on public.document_blocks for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "document_blocks_update_own"
on public.document_blocks for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "document_blocks_delete_own"
on public.document_blocks for delete to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "reading_progress_select_own" on public.reading_progress;
drop policy if exists "reading_progress_insert_own" on public.reading_progress;
drop policy if exists "reading_progress_update_own" on public.reading_progress;
drop policy if exists "reading_progress_delete_own" on public.reading_progress;

create policy "reading_progress_select_own"
on public.reading_progress for select to authenticated
using ((select auth.uid()) = user_id);

create policy "reading_progress_insert_own"
on public.reading_progress for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "reading_progress_update_own"
on public.reading_progress for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "reading_progress_delete_own"
on public.reading_progress for delete to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "reader_settings_select_own" on public.reader_settings;
drop policy if exists "reader_settings_insert_own" on public.reader_settings;
drop policy if exists "reader_settings_update_own" on public.reader_settings;
drop policy if exists "reader_settings_delete_own" on public.reader_settings;

create policy "reader_settings_select_own"
on public.reader_settings for select to authenticated
using ((select auth.uid()) = user_id);

create policy "reader_settings_insert_own"
on public.reader_settings for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "reader_settings_update_own"
on public.reader_settings for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "reader_settings_delete_own"
on public.reader_settings for delete to authenticated
using ((select auth.uid()) = user_id);

revoke all on public.documents from anon;
revoke all on public.document_blocks from anon;
revoke all on public.reading_progress from anon;
revoke all on public.reader_settings from anon;

grant select, insert, update, delete on public.documents to authenticated;
grant select, insert, update, delete on public.document_blocks to authenticated;
grant select, insert, update, delete on public.reading_progress to authenticated;
grant select, insert, update, delete on public.reader_settings to authenticated;

notify pgrst, 'reload schema';
