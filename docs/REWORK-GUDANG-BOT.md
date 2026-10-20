# REWORK BOT GUDANG MATERI v3 — CATATAN PERUBAHAN (SELESAI DIEKSEKUSI)

Tanggal: 2026-10-20
Status: IMPLEMENTED — backend + worker selesai, menunggu: SQL Supabase oleh Raken + deploy worker Cloudflare.

## A. FIX BUG (WAJIB)

### 1. `/cari` — Portal repository.bsi.ac.id berubah total
- Penyebab: endpoint lama `/cgi/search/simple` kini 404. Portal baru (Laravel) memuat hasil via AJAX.
- Alur baru (terverifikasi manual, sukses):
  1. GET `https://repository.bsi.ac.id/repo/cari?q=<kw>` → simpan cookie + ambil `searchToken` dari JS (`var searchToken = "..."`).
  2. GET `/repo/search-q/<kw>?type=all&page=1` dengan header `X-Search-Token`, cookie, `X-Requested-With: XMLHttpRequest`, User-Agent browser.
  3. Respons JSON `{result, last_page, html}` → parse blok `research-box1` (judul dari `h3.sidebar-title a`, penulis dari `small.text-muted`, tanggal).
- File yang diubah: `app/modules/repository.py` (`fetch_search` + `parse_repository_items`).

### 2. `/materi` — dua bug
- Field mismatch: worker baca `node.title`, backend kirim `judul`. Fix: worker baca `judul`.
- `file_url` relatif (mis. `storage/learning/...`) ditolak `is_safe_bsi_storage_url` (anti-SSRF).
  Fix: `parse_materials` absolutisasi URL (`urljoin` dengan base MyBest) sebelum return.

### 3. `/tugas` — mapping field salah total
| Worker baca (salah) | Backend kirim (benar) |
|---|---|
| `t.batas_waktu` | `t.selesai` |
| `t.status` | hitung dari `submissions` (join kode+judul) |
| `t.download_url` | `t.file_soal_url` |
| `t.tugas`/`t.nama` | `t.judul` |
| `t.mata_kuliah` | `t.kode` → diperkaya jadi nama matkul via `/courses` |

- Tambahan: urutkan berdasarkan deadline terdekat; highlight merah jika < 24 jam.

### 4. BUG LATENT tombol `dl_soal_` (base64 URL)
- `callback_data` Telegram maks 64 byte. `dl_soal_` + base64(URL storage) hampir selalu >64 byte → tombol gagal senyap.
- Fix: simpan mapping singkat (`short_id` → URL) di cache backend / tabel Supabase, callback hanya bawa `short_id`.

## B. ROMBAK PENGUMPULAN TUGAS — GOOGLE DRIVE

### Alur baru
1. `/tugas` → daftar tugas + token.
2. Anggota upload jawaban ke Google Drive → set "anyone with the link".
3. `/kumpul <token_tugas> <link_gdrive> [catatan]` (satu baris, tanpa upload file).
4. Bot validasi link (wajib drive.google.com/docs.google.com, tolak shortener), cek akses publik via oEmbed/HEAD.
5. Simpan ke tabel Supabase baru `ubsi_task_submissions`:
   `id, telegram_user_id, nim, token_tugas, judul_tugas, drive_link, catatan, submitted_at, is_late`
6. Arsip notifikasi ke DATACENTER + bukti ke DM anggota.
7. `/tugas` menampilkan status "✅ Sudah dikumpulkan via GDrive" dari tabel ini (valid 100%).

### Aturan
- Resubmit diperbolehkan (versi terakhir yang dihitung, riwayat tetap tersimpan).
- Lewat deadline tetap diterima tapi ditandai `is_late = true` + peringatan.
- Rate limit /kumpul per NIM (anti spam).

## C. TAMBAHAN DARI AUDIT MENYELURUH (USULAN NOELLE)

1. **Konfirmasi sebelum kumpul**: bot tampilkan preview (judul tugas + link + catatan) + tombol [✅ Kumpulkan] [❌ Batal] — cegah salah token/salah link.
2. **`/riwayat`**: anggota cek daftar tugas yang sudah dia kumpulkan + linknya.
3. **Token salah → fuzzy suggest**: tampilkan token aktif yang mirip.
4. **Validasi deadline otomatis**: `/kumpul` setelah `selesai` → warning LATE.
5. **Verifikasi `/buku` sekalian**: OPAC belum dites ulang setelah portal berubah — audit jalur yang sama.
6. **SQL migration**: file `sql-add-task-submissions.sql` (tabel + RLS service_role only), konsisten pola `ubsi_accounts`.
7. **README telegram-bots di-update**: dokumentasi perintah baru.
8. **Notifikasi cron Master**: pakai status GDrive (jangan ingatkan tugas yang sudah dikumpulkan).

## D. URUTAN EKSEKUSI (Jika disetujui)
1. Backend: fix `repository.py`, `elearning.py` (absolutisasi + enrichment nama matkul), endpoint short_id untuk file soal.
2. Worker gudang: fix mapping `/tugas`, `/materi`, `/cari`; rombak `/kumpul` → GDrive; tombol konfirmasi.
3. SQL: `ubsi_task_submissions`.
4. Deploy backend Railway → deploy worker gudang (+ master untuk cron status).
5. Uji end-to-end: login → /tugas valid → /kumpul GDrive → status update → /cari & /materi normal.
