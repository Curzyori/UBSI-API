# USRC Telegram Bots Ecosystem (Hub & Worker Architecture)

Sistem otomatisasi layanan akademik mahasiswa Universitas Bina Sarana Informatika untuk komunitas **USRC (UBSI Study & Research Club)**.

Menggunakan **Arsitektur 4 Bot (3 Bot Pekerja Spesialis di Topik Grup + 1 Bot Master Frontdesk di DM Pribadi)** yang terhubung ke Backend Headless FastAPI (`UBSI-API`) dan Database Supabase PostgreSQL.

---

## 1. Arsitektur & Alur Kerja (Workflow)

```
[ SUPERGROUP USRC TELEGRAM ]
  │
  ├── Topik: E-Learning & Absen  ──> [ worker-absen.js ]   ──┐
  ├── Topik: Statistik Nilai     ──> [ worker-stats.js ]   ──┼──> [ FastAPI Engine (Railway) ]
  └── Topik: Gudang Materi       ──> [ worker-gudang.js ]  ──┘                 │
                                                                               ▼
[ CHAT PRIBADI / DM ]                                                 [ Portal Kampus UBSI ]
  └── Frontdesk Mahasiswa        ──> [ worker-master.js ] <── (Bukti)  (MyBest, SIAKAD, EPrints)
                                             │
                                             ▼
                                    [ Supabase USRC DB ]
                                    (Tabel ubsi_accounts)
```

### Prinsip Keamanan & Privasi:
1. **Pemisahan Kredensial:** Hanya `worker-master.js` yang memiliki izin membaca/menulis akun login mahasiswa di Supabase. Bot di grup publik tidak memegang password.
2. **Kerahasiaan Nilai (Zero Leak):** Nilai KHS, IPK, dan detail komponen nilai tidak pernah dikirim ke grup publik. Bot Statistik hanya mengonfirmasi perhitungan di grup, sementara laporan detail dikirim rahasia ke DM via Bot Master.
3. **Absensi Transparan:** Anggota mengeksekusi tombol absen secara sadar di grup, bukti kehadiran lengkap langsung diteruskan ke DM pribadi.

---

## 2. Rincian Peran Masing-Masing Bot

### 👑 1. Bot Master (`worker-master.js`)
- **Lokasi:** Chat Pribadi (DM)
- **Fungsi:**
  - `/start`: Panduan onboarding mahasiswa.
  - `/login <NIM> <PASSWORD>`: Verifikasi akun ke sistem kampus dan simpan aman ke Supabase.
  - Pusat pengiriman bukti presensi dan laporan analisis nilai rahasia.

### 📚 2. Bot Gudang Materi (`worker-gudang.js`)
- **Lokasi:** Topik *Gudang Materi & Jurnal*
- **Fungsi:**
  - `/buku <kata kunci>`: Pencarian katalog OPAC Perpustakaan BSI beserta tautan baca.
  - `/cari <kata kunci>`: Pencarian skripsi, tugas akhir, dan riset di EPrints Repository BSI.
  - `/jurnal`: Menampilkan direktori e-journal resmi kampus.

### ⚡ 3. Bot Absensi MyBest (`worker-absen.js`)
- **Lokasi:** Topik *E-Learning & Absen*
- **Fungsi:**
  - `/absen` atau `/menu`: Memunculkan menu interaktif.
  - Tombol `[ ⚡ Absen Kelas Sekarang ]`: Deteksi sesi aktif di MyBest, bypass captcha teks, dan submit presensi mahasiswa.
  - Tombol `[ 📋 Cek Jadwal Kuliah ]`: Menampilkan jadwal kuliah mahasiswa bersangkutan.
  - Mengirimkan bukti kehadiran resmi ke DM via Bot Master.

### 📈 4. Bot Statistik & Nilai (`worker-stats.js`)
- **Lokasi:** Topik *Statistik Mahasiswa*
- **Fungsi:**
  - `/stats` atau `/menu`: Memunculkan menu diagnosis.
  - Tombol `[ 📊 Analisis Performa & Titik Lemah ]`:
    - Mengambil KHS dan rincian nilai berjalan dari SIAKAD.
    - Analisis matematis: mendeteksi matkul dengan nilai bocor (<70).
    - Menghitung simulasi target IPK / Cumlaude.
    - Mengirim laporan lengkap secara privat ke DM via Bot Master.

---

## 3. Konfigurasi Environment Variables (Cloudflare Workers)

Setiap Worker di Cloudflare membutuhkan Secrets/Variables berikut:

| Key | Worker yang Membutuhkan | Keterangan |
|---|---|---|
| `BACKEND_URL` | Semua Worker | URL Backend Railway (`https://ubsi-api-production.up.railway.app`) |
| `BACKEND_API_KEY` | Semua Worker | API Key internal backend (`usrc_secret_2026`) |
| `SUPABASE_URL` | Master, Absen, Stats | URL Supabase USRC |
| `SUPABASE_SERVICE_ROLE_KEY` | Master, Absen, Stats | Kunci Service Role Supabase untuk akses tabel `ubsi_accounts` |
| `BOT_TOKEN_MASTER` | Master, Absen, Stats | Token Telegram Bot Master |
| `BOT_TOKEN_GUDANG` | Gudang | Token Telegram Bot Gudang |
| `BOT_TOKEN_ABSEN` | Absen | Token Telegram Bot Absen |
| `BOT_TOKEN_STATS` | Stats | Token Telegram Bot Stats |

---

## 4. Cara Setting Webhook Telegram

Setelah masing-masing Worker di-deploy di Cloudflare, hubungkan webhook via browser:

```text
https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://<NAMA-WORKER>.workers.dev
```

*Tips:* Jika server Telegram mengalami kendala DNS (`Temporary failure in name resolution`), sertakan IP Cloudflare Edge:
```bash
curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://<NAMA-WORKER>.workers.dev", "ip_address": "172.67.171.211"}'
```

---

## 5. Skema Database Supabase

Tabel pendukung di PostgreSQL Supabase:

```sql
create table if not exists public.ubsi_accounts (
  telegram_user_id bigint primary key,
  user_id uuid references public.profiles(id) on delete set null,
  nim text not null,
  encrypted_password text not null,
  full_name text,
  prodi text,
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.ubsi_accounts enable row level security;

create policy "Service role manage ubsi accounts"
  on public.ubsi_accounts for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
```
