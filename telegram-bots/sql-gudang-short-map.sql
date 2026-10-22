-- ─────────────────────────────────────────────────────────────
-- USRC GUDANG V4: short map untuk callback_data (≤64 byte)
-- Menyimpan token matkul / URL file materi / token kumpul
-- di balik short_id 10 hex yang diklik anggota dari tombol.
-- Jalankan di Supabase SQL Editor (satu kali).
-- ─────────────────────────────────────────────────────────────

create table if not exists ubsi_short_map (
  sid        text primary key,
  val        text not null,
  kind       text not null,            -- 'matkul' | 'file' | 'kumpul'
  user_id    bigint,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null      -- 24 jam, selaras pola soal-map
);

-- RLS aktif tanpa policy publik: hanya service role (worker) yang bisa akses.
alter table ubsi_short_map enable row level security;
