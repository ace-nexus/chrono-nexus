-- =============================================================================
-- chrono-nexus: 自己管理手帳アプリ MVP データベーススキーマ
-- SORA PATCH 2026-09-06 / ADR 2026-09-07 準拠
-- 非破壊更新原則・予定と実績の完全分離・生入力とAI要約の分離
-- =============================================================================

-- 1. デイリーノート（1日1ページの表紙）
create table if not exists chrono_daily_notes (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  date date not null,
  title text,
  mood text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_chrono_daily_notes_user_date unique (user_id, date)
);

create index if not exists idx_chrono_daily_notes_date on chrono_daily_notes(date desc);
create index if not exists idx_chrono_daily_notes_user on chrono_daily_notes(user_id);

-- 2. 生入力データ（オーナーのメモ・音声ファイルURL・写真URL：絶対非破壊・上書き禁止）
create table if not exists chrono_raw_inputs (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references chrono_daily_notes(id) on delete cascade,
  input_type text not null check (input_type in ('text', 'voice', 'photo')),
  content text not null, -- テキストメモ本体、またはストレージ上のファイルパス/URL
  file_size_bytes bigint,
  duration_seconds integer, -- 音声の場合の秒数
  recorded_at timestamptz not null default now(),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_chrono_raw_inputs_note on chrono_raw_inputs(note_id);
create index if not exists idx_chrono_raw_inputs_type on chrono_raw_inputs(input_type);

-- 3. AI構造化・要約データ（Gemini等による清書結果：元データとは別行で保持）
create table if not exists chrono_ai_summaries (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references chrono_daily_notes(id) on delete cascade,
  raw_input_id uuid references chrono_raw_inputs(id) on delete set null,
  summary_type text not null default 'general' check (summary_type in ('general', 'action_items', 'reflection')),
  summary_content text not null,
  model_name text not null default 'gemini-1.5-flash',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_chrono_ai_summaries_note on chrono_ai_summaries(note_id);

-- 4. 予定（Googleカレンダー等から取り込んだ予定：実績とは完全分離）
create table if not exists chrono_schedule_events (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references chrono_daily_notes(id) on delete cascade,
  external_id text, -- Google CalendarのイベントID
  title text not null,
  description text,
  start_time timestamptz not null,
  end_time timestamptz,
  location text,
  source text not null default 'google_calendar',
  raw_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_chrono_schedule_events_note on chrono_schedule_events(note_id);
create index if not exists idx_chrono_schedule_events_start on chrono_schedule_events(start_time);

-- 5. 実績行動ログ（実際にオーナーがやった行動：予定とは完全分離）
create table if not exists chrono_activity_logs (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references chrono_daily_notes(id) on delete cascade,
  title text not null,
  start_time timestamptz,
  end_time timestamptz,
  location_name text,
  latitude double precision,
  longitude double precision,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_chrono_activity_logs_note on chrono_activity_logs(note_id);

-- 6. 位置情報トラックログ（端末GPS自動記録）
create table if not exists chrono_location_tracks (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  recorded_at timestamptz not null default now(),
  latitude double precision not null,
  longitude double precision not null,
  accuracy double precision,
  place_name text,
  note_id uuid references chrono_daily_notes(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_chrono_location_tracks_time on chrono_location_tracks(recorded_at desc);
create index if not exists idx_chrono_location_tracks_user on chrono_location_tracks(user_id);

-- 7. 分類タグ＆多軸ツリー用マスタ（日付/案件/場所/タグ）
create table if not exists chrono_tags (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null default 'tag' check (category in ('project', 'location', 'tag')),
  created_at timestamptz not null default now(),
  constraint uq_chrono_tags_name_category unique (name, category)
);

create table if not exists chrono_note_tags (
  note_id uuid not null references chrono_daily_notes(id) on delete cascade,
  tag_id uuid not null references chrono_tags(id) on delete cascade,
  primary key (note_id, tag_id)
);

-- =============================================================================
-- Storage バケットの準備（写真用ホットストレージ）
-- =============================================================================
insert into storage.buckets (id, name, public)
values ('chrono-photos', 'chrono-photos', true)
on conflict (id) do nothing;