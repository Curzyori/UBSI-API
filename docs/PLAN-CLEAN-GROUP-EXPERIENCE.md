# PLAN: Clean Group Experience — Bot Telegram USRC v2.1

**Tanggal:** 2026-10-21
**Status:** DIEKSEKUSI — kode selesai + `node --check` lulus semua worker + tersalin ke Desktop. Menunggu: sayso Raken (push git), jalankan SQL Supabase, set cron absen di Cloudflare, deploy manual 3 worker.
**Prinsip besar:** Grup tampil seperti papan informasi yang selalu bersih — yang nempel hanya bukti berhasil terverifikasi dan menu. Sisanya menguap, tapi tercatat di arsip yang bisa ditanya kapan pun.

---

## 0. RINGKASAN 9 PERUBAHAN

| # | Fitur | Worker | Ringkas |
|---|-------|--------|---------|
| 1 | Transaksi bersih saat sukses | gudang, absen | Saat berhasil: command + pesan proses dihapus, hanya bukti berhasil yang nempel. Gagal = tidak ada yang dihapus. |
| 2 | Jadwal ephemeral + berdetak | absen | List jadwal hidup ±20 menit, hitung mundur tick tiap menit, lalu menguap sendiri. |
| 3 | Tugas personal ke DM | gudang | `/tugas` → hasil pribadi ke DM, grup cuma notifikasi ringkas. |
| 4 | Menu tetap visible | (semua) | Panel tombol pinned tetap jadi pintu masuk — tidak diubah. |
| 5 | Ghost Log | gudang, absen, master | Semua yang menguap terarsip ke Supabase `ubsi_ghost_log` + mirror ke DATACENTER USRC. |
| 6 | Tombol Ajaib | gudang, absen | `[ 🔄 Perbarui ]`, `[ 🔁 Muat Ulang ]` — nol ketik command. |
| 7 | Mesin Waktu `/ingat` | master | Cari isi arsip ghost log lewat DM. |
| 8 | List Berdetak | absen | Cron tiap menit: edit-in-place countdown jadwal. |
| 9 | Kode Resi + `/cek` | gudang, absen, master | Bukti kumpul/absen bawa resi unik (`KMP-XXXX`/`ABS-XXXX`), verifikasi via DM. |

---

## 1. INFRASTRUKTUR — SUPABASE (3 TABEL BARU)

File SQL: `telegram-bots/sql-ghost-resi-ephemeral.sql` (dijalankan Raken di Supabase SQL Editor).

Konsisten pola existing (`ubsi_task_submissions`): RLS enable, TANPA policy → hanya service_role yang bisa akses (worker pakai service key).

### 1.1 `ubsi_ghost_log` — jejak audit semua yang menguap
```sql
id            bigint identity PK
bot           text        -- 'gudang' | 'absen' | 'stats' | 'master'
chat_id       bigint      -- grup / DM
thread_id     bigint      -- topik (nullable)
user_id       bigint
user_name     text
nim           text
command       text        -- teks command / aksi ('kumpul_ok', 'jadwal_kedaluwarsa', dst)
detail        text        -- ringkasan bebas
outcome       text        -- 'success' | 'failed' | 'cancelled' | 'expired' | 'dm_fallback'
created_at    timestamptz default now()
```
Index: `command`, `nim`, `created_at desc`.

### 1.2 `ubsi_receipts` — resi anti-rekayasa
```sql
id         bigint identity PK
code       text UNIQUE   -- 'KMP-7F3A' / 'ABS-9QX2'
type       text          -- 'kumpul' | 'absen'
user_id    bigint
nim        text
full_name  text
summary    text          -- deskripsi satu kalimat
ref_id     bigint        -- id baris sumber (ubsi_task_submissions.id, dst)
created_at timestamptz default now()
```

### 1.3 `ubsi_ephemeral_msgs` — pesan yang dijadwalkan menguap
```sql
id          bigint identity PK
bot         text          -- 'absen' | 'gudang'
chat_id     bigint
message_id  bigint        -- pesan bot yang akan dihapus
thread_id   bigint
user_id     bigint        -- pemohon
user_name   text
kind        text          -- 'jadwal' | 'kumpul_preview'
ref_id      bigint        -- subId utk kumpul_preview
payload     jsonb         -- item list utk tick countdown
cmd_msg_id  bigint        -- pesan command user yang ikut dihapus
created_at  timestamptz default now()
expires_at  timestamptz
```
Index: `expires_at`, `(kind, ref_id)`.

---

## 2. WORKER BOT GUDANG (`worker-bot-gudang.js`)

### 2.1 Helper baru (global functions)
- `sendTelegram` → sudah return json; dipakai `j.result.message_id`.
- `tgApi(token, method, body)` — panggil API generik (editMessageText, deleteMessage).
- `deleteMsg(token, chatId, msgId)` — sudah ada (`deleteMessage`), dipakai.
- `ghostLog(env-like, {...})` — insert `ubsi_ghost_log` (fire-and-forget, `.catch(()=>{})`) + mirror satu baris ke DATACENTER jika `DATACENTER_CHAT_ID` terisi.
- `genCode(prefix)` — `prefix-` + 4 char dari set aman `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (tanpa I,L,O,0,1) via `crypto.getRandomValues`.
- `saveReceipt(supabaseUrl, supabaseKey, {...})` — insert `ubsi_receipts`, return code atau null (gagal tabel = jangan gagalkan alur utama).

### 2.2 Alur `/kumpul` (transaksi)
1. Entry `/kumpul` → capture `msg.message_id` sebagai `cmdMsgId`, diteruskan ke `handleKumpulGDrive`.
2. Semua jalur GAGAL (format salah, link invalid, token tidak ada, simpan gagal, batal) → **tidak ada yang dihapus** + ghost log `outcome: failed/cancelled`.
3. Jalur sukses (preview tampil): sebelum kirim preview, insert row `ubsi_ephemeral_msgs`:
   `kind='kumpul_preview', ref_id=subId, cmd_msg_id, cmd_user_id, chat_id, thread_id` (tanpa expires — dihapus saat dikonfirmasi).
4. Callback `kumpul_ok_<subId>`:
   - PATCH status `submitted` (existing).
   - `genCode('KMP')` → `saveReceipt` (summary: judul tugas + link + status tepat/terlambat, ref_id=subId).
   - Hapus: pesan preview (query.message.message_id) + pesan command (cmd_msg_id dari row ephemeral) + row ephemeral.
   - Kirim **bukti berhasil** (existing text) + tambahan `🧾 *Resi:* \`KMP-XXXX\`` + tombol `[ 🔄 Cek Tugas Lagi ]` → `callback_data: re_tugas`.
   - Arsip DATACENTER (existing) + tambah baris `🧾 Resi: KMP-XXXX`.
   - Ghost log `command='kumpul_ok', outcome='success'`.
5. Callback `kumpul_no_<subId>`: existing (pesan dibiarkan) + ghost log `cancelled`.

### 2.3 Alur `/tugas` (personal ke DM)
1. Ambil data tugas (existing; mapping baru).
2. Jika data gagal diambil → error di grup, command dibiarkan (gagal = biarkan).
3. Jika data OK:
   - **Hapus command user** di grup.
   - Render list (refactor renderer existing jadi `buildTugasText(...)` agar reusable).
   - Kirim list **ke DM user via bot gudang** (`sendTelegram(botToken, userId, ...)`) + tombol `dl_soal_` (existing, callback tetap valid karena pengirimnya bot gudang) + `[ 🔁 Muat Ulang ]` → `re_tugas`.
   - Di grup kirim notifikasi ringkas: `📋 <Nama>, daftar tugas (N) terkirim ke DM kamu.`
   - Ghost log `command='/tugas', outcome='success'`.
4. **Fallback**: DM gagal (user belum /start bot gudang, HTTP 403) → list dikirim ke grup seperti perilaku lama + ghost log `outcome='dm_fallback'` (kegagalan kirim ≠ kegagalan data; tetap dilayani).

### 2.4 Callback baru
- `re_tugas`: jalankan ulang alur `/tugas` untuk siapa pun yang klik (sumber edit-in-place: coba `editMessageText` pesan DM; bila pesan terlalu tua / gagal → kirim DM baru).

---

## 3. WORKER BOT ABSEN (`worker-bot-absen.js`)

### 3.1 Helper baru
- Normalisasi `sendTelegram` agar **selalu return json** (sekarang jalur fallback return raw Response) → butuh `j.result.message_id`.
- `tgApi`, `ghostLog`, `genCode`, `saveReceipt` — salinan dari gudang (worker = file standalone, duplikasi kecil disengaja).

### 3.2 `/absen` (btn_absen_now) — transaksi + resi
- Sukses: 
  - `genCode('ABS')` → `saveReceipt` (summary: matkul + dosen + jam, ref_id=null).
  - Notif grup (existing) + tambah `🧾 Resi: ABS-XXXX`.
  - DM bukti via Master (existing) + tambah `🧾 Resi: \`ABS-XXXX\`` + baris "_Verifikasi: /cek ABS-XXXX ke Bot Master_".
  - Ghost log `command='btn_absen_now', outcome='success'`.
- Gagal: existing (pesan error dibiarkan) + ghost log `failed`.
- Ini klik tombol (bukan ketikan) — tidak ada command untuk dihapus; notif grup = bukti, tetap nempel.

### 3.3 `/jadwal` (btn_jadwal_today) — list hidup berdetak
- Sukses ambil data:
  - Bangun `items = schData.data.map(j => ({nama, sks, hari, jam, ruang}))`.
  - Render text + footer `_⏱ List hidup — menguap otomatis dalam 20 menit._` + tombol `[ 🔄 Perbarui ]` → `re_jadwal`.
  - Kirim (dapat `message_id`) → insert `ubsi_ephemeral_msgs`:
    `bot='absen', kind='jadwal', payload={items}, expires_at=now+20m, cmd_msg_id=null, user_id, user_name, thread_id`.
  - Ghost log `command='btn_jadwal_today', outcome='success'`.
- Gagal: existing + ghost log.
- (Tombol jadwal bukan ketikan — tidak ada command dihapus.)

### 3.4 Callback `re_jadwal`
- Ambil jadwal baru → `editMessageText` pesan yang sama (edit-in-place) → update `payload` + reset `expires_at = now+20m` → `answerCallback("Jadwal diperbarui")`.
- Gagal edit (pesan terlalu tua) → kirim pesan baru via alur 3.3.

### 3.5 Cron `scheduled()` — tick tiap menit + sweep
Handler baru `async scheduled(event, env, ctx)` — pasang cron `* * * * *` di Cloudflare dashboard:
1. Load `ubsi_ephemeral_msgs?bot=eq.absen`:
   - **Kedaluwarsa** (`expires_at <= now`): `deleteMessage` + hapus row + ghost log `command='jadwal_kedaluwarsa', outcome='expired'`.
   - **Masih hidup**: rebuild text dari `payload.items` dengan **countdown live** per item:
     - Parse `hari` (Senin–Minggu → indeks) + `jam` (`HH:MM-HH:MM`, ambil start & end).
     - Hari ini & belum mulai → `⏳ mulai dalam Xj Ym`.
     - Hari ini & sedang berlangsung → `🔥 berlangsung — selesai dalam Xj Ym`.
     - Selain itu → tampil apa adanya.
     - Footer: `⏱ Menguap dalam Xm`.
     - Timezone: `Asia/Pontianak` (konsisten dengan absen existing).
     - `editMessageText`; jika gagal (pesan sudah dihapus manual) → hapus row-nya saja.
2. Tanpa row → langsung return (hemat).

---

## 4. WORKER BOT MASTER (`worker-bot-master.js`)

### 4.1 `/ingat <kata kunci>` (DM only)
- Query `ubsi_ghost_log`: `or=(command.ilike.*kw*,detail.ilike.*kw*,user_name.ilike.*kw*,nim.eq.<kw>)` + `order=created_at.desc` + `limit=10`.
- Render: `🧠 MESIN WAKTU — hasil untuk "<kw>"` per baris: waktu WIB • nama (NIM) • command • detail • outcome.
- Tanpa kata kunci → 10 event terakhir.
- Tanpa hasil → jawapan manis "arsip bersih, tidak ditemukan".

### 4.2 `/cek <KODE>` (DM only)
- Normalisasi uppercase; validasi pola `^(KMP|ABS)-[A-Z0-9]{4}$`.
- Cocok → select `ubsi_receipts?code=ilike.<KODE>`:
  - Ditemukan → `✅ RESI TERVERIFIKASI` + type, nama, NIM, summary, waktu.
  - Tidak → `❌ Resi tidak ditemukan` (screenshot palsu / salah ketik).
- Pola salah → hint format.

### 4.3 Fix cron notifikasi tugas (utang dari REWORK-GUDANG-BOT C.8)
Mapping field lama → baru:
| Lama (salah) | Baru (benar) |
|---|---|
| `t.batas_waktu` | `t.selesai` |
| `t.tugas` / `t.nama` | `t.judul` |
| filter status string | filter dari `submissions` GDrive |
- Tambah: ambil `ubsi_task_submissions?nim=eq.<nim>&status=eq.submitted&select=token_tugas` → skip tugas yang token-nya sudah dikumpulkan (jangan ingatkan tugas yang sudah dikerjakan).

---

## 5. README (`telegram-bots/README.md`)
- Tambah perintah Master: `/ingat`, `/cek`.
- Bagian baru "Perilaku Grup Bersih (Clean Group Experience)": transaksi, jadwal ephemeral, tugas ke DM, ghost log, resi.
- Catatan deploy: worker **absen wajib cron trigger `* * * * *`** di dashboard Cloudflare; SQL wajib dijalankan dulu.

---

## 6. URUTAN EKSEKUSI
1. ✅ SQL file dibuat (`telegram-bots/sql-ghost-resi-ephemeral.sql`).
2. ✅ Worker gudang diubah (2.1–2.4).
3. ✅ Worker absen diubah (3.1–3.5 + `scheduled`).
4. ✅ Worker master diubah (4.1–4.3).
5. ✅ README diperbarui.
6. ✅ Verifikasi sintaks `node --check` semua worker.
7. ✅ Salin semua worker ke Desktop (siap tempel Cloudflare).
8. ⏳ **MENUNGGU SAYSO RAKEN** untuk: push git + jalankan SQL Supabase + set cron absen di dashboard + deploy manual 3 worker.

## 7. CATATAN DESAIN
- **Tanpa KV binding** — semua state ephemeral di Supabase (pola existing, nol konfigurasi tambahan di Cloudflare selain cron).
- **Duplikasi helper antar worker disengaja** — worker standalone single-file, gaya existing.
- Kegagalan tabel baru (belum di-migrate) **tidak boleh memutus alur utama** — semua insert dibungkus try/catch; fitur cleanup/resi degrade gracefully (pesan tidak dihapus, resi kosong), bot tetap berfungsi.
- Telegram membatasi delete pesan bot ±48 jam — semua penghapusan dilakukan segera setelah event, tidak bergantung pada umur.
