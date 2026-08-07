-- 이어읽기 v2 -> v3 EPUB 지원 마이그레이션
-- Supabase Dashboard > SQL Editor에서 전체 실행하세요.

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

update public.documents
set file_type = case
  when lower(original_filename) like '%.epub' then 'epub'
  else 'txt'
end
where file_type is null or file_type not in ('txt', 'epub');

update public.documents set toc = '[]'::jsonb where toc is null;
update public.document_blocks set chapter_index = 0 where chapter_index is null;
update public.document_blocks set block_kind = 'paragraph' where block_kind is null;

-- 재실행 가능한 제약조건 추가
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'documents_file_type_check'
      AND conrelid = 'public.documents'::regclass
  ) THEN
    ALTER TABLE public.documents
      ADD CONSTRAINT documents_file_type_check CHECK (file_type IN ('txt', 'epub'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'document_blocks_chapter_index_check'
      AND conrelid = 'public.document_blocks'::regclass
  ) THEN
    ALTER TABLE public.document_blocks
      ADD CONSTRAINT document_blocks_chapter_index_check CHECK (chapter_index >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'document_blocks_kind_check'
      AND conrelid = 'public.document_blocks'::regclass
  ) THEN
    ALTER TABLE public.document_blocks
      ADD CONSTRAINT document_blocks_kind_check CHECK (block_kind IN ('paragraph', 'heading', 'chapter'));
  END IF;
END
$$;

create index if not exists document_blocks_chapter_idx
  on public.document_blocks(user_id, document_id, chapter_index, block_index);

notify pgrst, 'reload schema';
