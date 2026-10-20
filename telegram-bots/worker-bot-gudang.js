/**
 * USRC BOT GUDANG MATERI v3.0 (Perpustakaan, Repository, Materi, & Ruang Tugas MyBest)
 * Menangani di Topik Grup (Thread ID: 7) & DM:
 * 1. /buku <kata kunci>     -> Katalog OPAC Perpustakaan BSI
 * 2. /cari <kata kunci>     -> Skripsi / TA di EPrints Repository BSI (portal baru, AJAX+token)
 * 3. /jurnal                -> Katalog e-journal resmi kampus
 * 4. /materi <kata kunci>   -> Slide/PDF materi MyBest (judul=judul, URL absolut)
 * 5. /tugas                 -> Daftar tugas valid (nama matkul, deadline, status GDrive/MyBest) + tombol soal (short_id)
 * 6. /kumpul <token> <link_gdrive> [catatan] -> Pengumpulan tugas via Google Drive (wajib link)
 */

export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'POST') {
      return new Response('USRC Gudang Materi Bot v3.0 Active', { status: 200 });
    }

    try {
      const update = await request.json();
      const botToken = env.BOT_TOKEN_GUDANG;
      const backendUrl = (env.BACKEND_URL || 'https://ubsi-api-production.up.railway.app').replace(/\/$/, '');
      const apiKey = env.BACKEND_API_KEY || 'usrc_secret_2026';
      const supabaseUrl = env.SUPABASE_URL || 'https://wagvbmkimpswiidnenwx.supabase.co';
      const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;
      const datacenterChatId = env.DATACENTER_CHAT_ID || '';

      // ── 1. TANGANI TOMBOL KLIK (Callback Query) ──
      if (update.callback_query) {
        const query = update.callback_query;
        const cbData = query.data;
        const userId = query.from.id;
        const userName = query.from.first_name || "Mahasiswa";
        const chatId = query.message?.chat?.id || userId;
        const threadId = query.message?.message_thread_id || null;

        // Satpam topik 7
        const isGroup = query.message?.chat?.type === 'group' || query.message?.chat?.type === 'supergroup';
        if (isGroup && Number(threadId) !== 7) {
          await answerCallback(botToken, query.id, "Fitur ini hanya aktif di Topik Gudang Materi!");
          return new Response('OK', { status: 200 });
        }

        const acc = await getStudentAccount(supabaseUrl, supabaseKey, userId);
        if (!acc) {
          await answerCallback(botToken, query.id, "Akun belum terhubung! Silakan login di DM Bot Master.");
          return new Response('OK', { status: 200 });
        }

        if (cbData === "btn_list_tugas") {
          await answerCallback(botToken, query.id, "Mengambil daftar tugas aktif...");
          await handleListTugas(botToken, chatId, threadId, acc, backendUrl, apiKey, supabaseUrl, supabaseKey);
          return new Response('OK', { status: 200 });
        }

        // dl_soal_<short_id 10 hex> (total 18 byte, aman di bawah batas 64 byte Telegram)
        if (cbData.startsWith("dl_soal_")) {
          const sid = cbData.replace("dl_soal_", "");
          await answerCallback(botToken, query.id, "Mengunduh berkas soal tugas...");
          const linkRes = await safeFetchJson(`${backendUrl}/v1/elearning/soal-map/${sid}`, {
            headers: { 'X-API-Key': apiKey }
          });
          const fileUrl = linkRes.ok && linkRes.data?.data?.url;
          if (!fileUrl) {
            await sendTelegram(botToken, chatId, `⚠️ ${linkRes.data?.error?.message || "Daftar tugas kedaluwarsa, ketik /tugas untuk muat ulang."}`, threadId);
            return new Response('OK', { status: 200 });
          }
          await handleDownloadFile(botToken, chatId, threadId, acc, backendUrl, apiKey, fileUrl, datacenterChatId, "Soal Tugas");
          return new Response('OK', { status: 200 });
        }

        // Konfirmasi pengumpulan GDrive
        if (cbData.startsWith("kumpul_ok_") || cbData.startsWith("kumpul_no_")) {
          const subId = cbData.replace("kumpul_ok_", "").replace("kumpul_no_", "");
          if (!/^\d+$/.test(subId)) {
            await answerCallback(botToken, query.id);
            return new Response('OK', { status: 200 });
          }

          if (cbData.startsWith("kumpul_no_")) {
            await fetch(`${supabaseUrl}/rest/v1/ubsi_task_submissions?id=eq.${subId}`, {
              method: 'DELETE',
              headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
            });
            await answerCallback(botToken, query.id, "Dibatalkan.");
            await sendTelegram(botToken, chatId, "❌ *Pengumpulan dibatalkan.* Tidak ada data yang tersimpan.", threadId);
            return new Response('OK', { status: 200 });
          }

          // Ambil data submission lalu konfirmasi
          const rowRes = await safeFetchJson(`${supabaseUrl}/rest/v1/ubsi_task_submissions?id=eq.${subId}&select=*`, {
            headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
          });
          const row = Array.isArray(rowRes.data) ? rowRes.data[0] : null;
          if (!row) {
            await answerCallback(botToken, query.id, "Data tidak ditemukan.");
            return new Response('OK', { status: 200 });
          }

          await fetch(`${supabaseUrl}/rest/v1/ubsi_task_submissions?id=eq.${subId}`, {
            method: 'PATCH',
            headers: {
              'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ status: 'submitted', confirmed_at: new Date().toISOString() })
          });

          await answerCallback(botToken, query.id, "Tugas terkumpul!");
          await sendTelegram(
            botToken, chatId,
            `🎉 *TUGAS BERHASIL DIKUMPULKAN (GOOGLE DRIVE)*\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `👤 *Mahasiswa:* ${row.full_name || userName} (\`${row.nim}\`)\n` +
            `📌 *Tugas:* ${row.judul_tugas || row.token_tugas}\n` +
            `🔑 *Token:* \`${row.token_tugas}\`\n` +
            `🔗 *Link:* ${row.drive_link}\n` +
            (row.catatan ? `💬 *Catatan:* ${row.catatan}\n` : "") +
            (row.is_late ? `⚠️ *Status: TERLAMBAT (melewati deadline)*\n` : `✅ *Status: TEPAT WAKTU*\n`) +
            `\n_Bukti pengumpulan tercatat permanen di sistem USRC._ 🤍`,
            threadId
          );

          // Arsip ke DATACENTER USRC
          if (datacenterChatId) {
            await sendTelegram(botToken, datacenterChatId,
              `📥 *ARSIP PENGUMPULAN TUGAS (GDRIVE)*\n` +
              `━━━━━━━━━━━━━━━━━━━━\n` +
              `👤 ${row.full_name || '-'} (${row.nim})\n` +
              `📌 ${row.judul_tugas || '-'}\n` +
              `🔑 Token: ${row.token_tugas}\n` +
              `🔗 ${row.drive_link}\n` +
              `💬 ${row.catatan || '-'}\n` +
              `⏰ ${row.is_late ? 'TERLAMBAT' : 'TEPAT WAKTU'}\n` +
              `📅 ${new Date().toISOString()}`
            ).catch(() => {});
          }
          return new Response('OK', { status: 200 });
        }

        await answerCallback(botToken, query.id);
        return new Response('OK', { status: 200 });
      }

      // ── 2. TANGANI PESAN (MESSAGE) ──
      if (!update.message) return new Response('OK', { status: 200 });

      const msg = update.message;
      const chatId = msg.chat.id;
      const threadId = msg.message_thread_id || null;
      const text = (msg.text || '').trim();
      const userId = msg.from.id;
      const userName = msg.from.first_name || "Mahasiswa";

      // ── KUNCI SATPAM TOPIK GUDANG MATERI (Thread ID: 7) ──
      const isGroup = msg.chat.type === 'group' || msg.chat.type === 'supergroup';
      if (isGroup && Number(threadId) !== 7) {
        return new Response('Ignored out-of-topic message', { status: 200 });
      }

      // ── A. PERINTAH KUMPUL TUGAS VIA GOOGLE DRIVE ──
      if (text.startsWith('/kumpul')) {
        const acc = await getStudentAccount(supabaseUrl, supabaseKey, userId);
        if (!acc) {
          await sendTelegram(botToken, chatId, "🔒 Pengumpulan tugas memerlukan akun MyBest. Login dulu di DM *Bot Master*.", threadId);
          return new Response('OK', { status: 200 });
        }

        // Info upload file lama -> arahkan ke GDrive
        if (msg.document) {
          await sendTelegram(
            botToken, chatId,
            "⚠️ *Metode upload file via Telegram sudah diganti.*\n\nSekarang pengumpulan wajib menggunakan **link Google Drive**:\n`/kumpul <token_tugas> <link_gdrive> [catatan]`",
            threadId
          );
          return new Response('OK', { status: 200 });
        }

        await handleKumpulGDrive(botToken, chatId, threadId, acc, backendUrl, apiKey, supabaseUrl, supabaseKey, text, userName);
        return new Response('OK', { status: 200 });
      }

      // ── B. RUANG TUGAS MYBEST (/tugas) ──
      if (text.startsWith('/tugas')) {
        const acc = await getStudentAccount(supabaseUrl, supabaseKey, userId);
        if (!acc) {
          await sendTelegram(botToken, chatId, "🔒 Ruang tugas memerlukan akun MyBest. Login dulu di DM *Bot Master* dengan `/login <NIM> <PASSWORD>`.", threadId);
          return new Response('OK', { status: 200 });
        }

        await sendTelegram(botToken, chatId, `⏳ *Mengambil daftar tugas kuliah aktif untuk ${userName}...*`, threadId);
        await handleListTugas(botToken, chatId, threadId, acc, backendUrl, apiKey, supabaseUrl, supabaseKey);
        return new Response('OK', { status: 200 });
      }

      // ── C. CARI BUKU PERPUSTAKAAN OPAC (/buku <keyword>) ──
      if (text.startsWith('/buku')) {
        const query = text.replace(/^\/buku(@\w+)?/, '').trim();
        if (!query) {
          await sendTelegram(botToken, chatId, "📚 *Perpustakaan BSI*\n\nKetik `/buku <kata kunci judul buku>`\nContoh: `/buku pemrograman web`", threadId);
          return new Response('OK', { status: 200 });
        }

        try {
          const res = await fetch(`${backendUrl}/v1/elibrary/search?q=${encodeURIComponent(query)}`, {
            headers: { 'X-API-Key': apiKey }
          });
          const json = await res.json();

          if (!json.success || !json.data || json.data.length === 0) {
            await sendTelegram(botToken, chatId, `⚠️ Tidak ditemukan buku untuk kata kunci "${query}".`, threadId);
            return new Response('OK', { status: 200 });
          }

          let out = `📚 *KATALOG OPAC PERPUSTAKAAN BSI:*\n\n`;
          json.data.slice(0, 5).forEach((b, idx) => {
            out += `${idx + 1}. *${b.title}*\n`;
            if (b.author) out += `   ✍️ ${b.author}\n`;
            if (b.year) out += `   📅 ${b.year}\n`;
            if (b.url) out += `   🔗 [Buka Katalog](${b.url})\n\n`;
          });

          await sendTelegram(botToken, chatId, out, threadId);
        } catch (err) {
          await sendTelegram(botToken, chatId, `❌ Gagal menghubungi perpustakaan: ${err.message}`, threadId);
        }

        return new Response('OK', { status: 200 });
      }

      // ── D. CARI SKRIPSI / TA / MAKALAH EPRINTS (/cari <keyword>) ──
      if (text.startsWith('/cari')) {
        const query = text.replace(/^\/cari(@\w+)?/, '').trim();
        if (!query) {
          await sendTelegram(botToken, chatId, "🎓 *Repositori Skripsi & Riset USRC*\n\nKetik `/cari <kata kunci penelitian>`\nContoh: `/cari sistem pakar` atau `/cari machine learning`", threadId);
          return new Response('OK', { status: 200 });
        }

        await sendTelegram(botToken, chatId, `🔍 Mencari repositori riset: "${query}"...`, threadId);

        try {
          const res = await fetch(`${backendUrl}/v1/repository/search?q=${encodeURIComponent(query)}`, {
            headers: { 'X-API-Key': apiKey }
          });
          const json = await res.json();

          if (!json.success || !json.data || json.data.length === 0) {
            await sendTelegram(botToken, chatId, `⚠️ Tidak ditemukan dokumen riset untuk kata kunci "${query}".`, threadId);
            return new Response('OK', { status: 200 });
          }

          const items = json.data.slice(0, 5);
          let out = `🎓 *REPOSITORI KAMPUS UBSI:*\n\n`;

          items.forEach((r, idx) => {
            out += `${idx + 1}. *${r.title}*\n`;
            if (r.author) out += `   👤 ${r.author}\n`;
            if (r.year) out += `   📅 ${r.year}\n`;
            if (r.url) out += `   📄 [Buka Dokumen](${r.url})\n\n`;
          });

          await sendTelegram(botToken, chatId, out, threadId);

        } catch (err) {
          await sendTelegram(botToken, chatId, `❌ Gagal menghubungi repositori kampus: ${err.message}`, threadId);
        }

        return new Response('OK', { status: 200 });
      }

      // ── E. KATALOG JURNAL ILMIAH (/jurnal) ──
      if (text.startsWith('/jurnal')) {
        try {
          const res = await fetch(`${backendUrl}/v1/ejournal/journals`, {
            headers: { 'X-API-Key': apiKey }
          });
          const json = await res.json();

          if (!json.success || !json.data || json.data.length === 0) {
            await sendTelegram(botToken, chatId, "⚠️ Belum ada katalog jurnal yang terdaftar.", threadId);
            return new Response('OK', { status: 200 });
          }

          let out = `📑 *KATALOG E-JOURNAL OJS UBSI:*\n\n`;
          json.data.slice(0, 6).forEach((j, idx) => {
            out += `${idx + 1}. *${j.name || j.title}*\n   🔗 [Kunjungi Portal](${j.url})\n\n`;
          });

          await sendTelegram(botToken, chatId, out, threadId);
        } catch (err) {
          await sendTelegram(botToken, chatId, `❌ Gagal mengambil e-journal: ${err.message}`, threadId);
        }

        return new Response('OK', { status: 200 });
      }

      // ── F. SLIDE MATERI MYBEST (/materi <keyword>) ──
      if (text.startsWith('/materi')) {
        const query = text.replace(/^\/materi(@\w+)?/, '').trim().toLowerCase();
        if (!query) {
          await sendTelegram(botToken, chatId, "📗 *Materi Kuliah MyBest*\n\nKetik `/materi <kata kunci>`\nContoh: `/materi basis data`\n\nFile PDF langsung dikirim ke sini + diarsipkan di DATACENTER USRC.", threadId);
          return new Response('OK', { status: 200 });
        }

        const acc = await getStudentAccount(supabaseUrl, supabaseKey, userId);
        if (!acc) {
          await sendTelegram(botToken, chatId, "🔒 Materi butuh akun MyBest. Login dulu di DM *Bot Master* dengan `/login <NIM> <PASSWORD>`.", threadId);
          return new Response('OK', { status: 200 });
        }

        const statusMsg = await sendTelegram(botToken, chatId, `🔍 Mencari materi "${query}" di MyBest...`, threadId);
        const statusMsgId = statusMsg && statusMsg.result ? statusMsg.result.message_id : null;

        try {
          const cRes = await fetch(`${backendUrl}/v1/elearning/courses`, {
            headers: {
              'X-API-Key': apiKey,
              'X-Elearning-NIM': acc.nim,
              'X-Elearning-Pass': acc.encrypted_password,
              'X-Nim': acc.nim,
              'X-Pass': acc.encrypted_password,
            }
          });
          const cJson = await cRes.json();
          const courses = (cJson.data || []).filter(c => c.token_learning);

          const files = [];
          for (const c of courses.slice(0, 8)) {
            const courseName = c.nama || c.matakuliah || c.name || c.kode || "Matkul";
            try {
              const mRes = await fetch(`${backendUrl}/v1/elearning/materials?token=${encodeURIComponent(c.token_learning)}`, {
                headers: {
                  'X-API-Key': apiKey,
                  'X-Elearning-NIM': acc.nim,
                  'X-Elearning-Pass': acc.encrypted_password,
                  'X-Nim': acc.nim,
                  'X-Pass': acc.encrypted_password,
                }
              });
              const mJson = await mRes.json();
              collectFileUrls(mJson.data, courseName, files);
            } catch (e) {}
          }

          const matches = files.filter(f => f.title.toLowerCase().includes(query));
          if (matches.length === 0) {
            if (statusMsgId) await deleteMessage(botToken, chatId, statusMsgId);
            await sendTelegram(botToken, chatId, `⚠️ Tidak ada materi yang cocok dengan "${query}". Coba kata kunci lain.`, threadId);
            return new Response('OK', { status: 200 });
          }

          if (statusMsgId) await deleteMessage(botToken, chatId, statusMsgId);
          await sendTelegram(botToken, chatId, `📗 Ditemukan ${matches.length} materi. Mengirim berkas...`, threadId);

          let sent = 0;
          for (const f of matches.slice(0, 3)) {
            const ok = await handleDownloadFile(botToken, chatId, threadId, acc, backendUrl, apiKey, f.url, datacenterChatId, f.title, f.course);
            if (ok) sent++;
          }

          if (sent === 0) {
            await sendTelegram(botToken, chatId, "⚠️ Materi ditemukan tapi gagal dikirim sebagai file.", threadId);
          }

        } catch (err) {
          if (statusMsgId) await deleteMessage(botToken, chatId, statusMsgId);
          await sendTelegram(botToken, chatId, `❌ Gagal mencari materi: ${err.message}`, threadId);
        }
        return new Response('OK', { status: 200 });
      }

      // Menu default topik
      if (text.startsWith('/menu') || text.startsWith('/start')) {
        const menuText =
          "📚 *GUDANG MATERI & RUANG TUGAS USRC v3.0*\n\n" +
          "Akses seluruh pustaka akademik dan tugas E-Learning MyBest langsung dari Telegram:\n\n" +
          "• `/tugas` — Daftar tugas aktif + status pengumpulan\n" +
          "• `/kumpul <token> <link_gdrive> [catatan]` — Kumpul tugas via Google Drive\n" +
          "• `/materi <keyword>` — Unduh slide kuliah MyBest\n" +
          "• `/buku <keyword>` — Cari buku katalog OPAC\n" +
          "• `/cari <keyword>` — Riset & skripsi EPrints\n" +
          "• `/jurnal` — Daftar e-journal kampus";

        const replyMarkup = {
          inline_keyboard: [
            [
              { text: "📝 Daftar Tugas Aktif", callback_data: "btn_list_tugas" }
            ]
          ]
        };

        await sendTelegram(botToken, chatId, menuText, threadId, replyMarkup);
        return new Response('OK', { status: 200 });
      }

      return new Response('OK', { status: 200 });

    } catch (err) {
      return new Response('Error: ' + err.message, { status: 500 });
    }
  }
};

// ── HANDLER FUNCTIONS ──

function parseDeadline(selesaiStr) {
  if (!selesaiStr) return null;
  // Format umum MyBest: "YYYY-MM-DD HH:MM:SS" (atau dengan detik terpotong)
  const m = String(selesaiStr).match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] || "00"}+07:00`);
    if (!isNaN(d.getTime())) return d;
  }
  const fallback = new Date(String(selesaiStr).replace(" ", "T") + "+07:00");
  return isNaN(fallback.getTime()) ? null : fallback;
}

async function handleListTugas(botToken, chatId, threadId, acc, backendUrl, apiKey, supabaseUrl, supabaseKey) {
  try {
    const credHeaders = {
      'X-API-Key': apiKey,
      'X-Elearning-NIM': acc.nim,
      'X-Elearning-Pass': acc.encrypted_password,
      'X-Nim': acc.nim,
      'X-Pass': acc.encrypted_password,
    };

    const [asgRes, crsRes] = await Promise.all([
      safeFetchJson(`${backendUrl}/v1/elearning/assignments`, { headers: credHeaders }),
      safeFetchJson(`${backendUrl}/v1/elearning/courses`, { headers: credHeaders }),
    ]);

    if (!asgRes.ok || !asgRes.data?.success) {
      throw new Error(asgRes.data?.error?.message || `Gagal membuka data ruang tugas (${asgRes.status || "timeout"}).`);
    }

    const tasks = asgRes.data?.data?.tasks || [];
    const subs = asgRes.data?.data?.submissions || [];
    const courses = (crsRes.ok && crsRes.data?.data) || [];

    // Map kode matkul -> nama matkul
    const courseMap = {};
    courses.forEach(c => {
      if (c.kode) courseMap[String(c.kode).toUpperCase()] = c.nama || c.matakuliah || c.name || null;
    });

    // Status GDrive dari tabel submission USRC (abaikan error bila tabel belum dibuat)
    let gdriveMap = {};
    try {
      const gRes = await safeFetchJson(
        `${supabaseUrl}/rest/v1/ubsi_task_submissions?nim=eq.${encodeURIComponent(acc.nim)}&status=eq.submitted&select=token_tugas`,
        { headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` } }
      );
      if (gRes.ok && Array.isArray(gRes.data)) {
        gdriveMap = Object.fromEntries(gRes.data.map(r => [r.token_tugas, true]));
      }
    } catch (_) {}

    if (tasks.length === 0) {
      await sendTelegram(botToken, chatId, "🎉 *Tidak ada tugas aktif di MyBest saat ini.* Waktunya santai atau riset!", threadId);
      return;
    }

    // Tandai status tiap tugas + urutkan berdasarkan deadline terdekat
    const enriched = tasks.map(t => {
      const deadline = parseDeadline(t.selesai);
      const doneGDrive = !!gdriveMap[t.token_tugas];
      const doneMyBest = subs.some(s => s.kode === t.kode && s.judul === t.judul);
      return { ...t, deadline, doneGDrive, doneMyBest };
    }).sort((a, b) => {
      if (a.deadline && b.deadline) return a.deadline - b.deadline;
      if (a.deadline) return -1;
      if (b.deadline) return 1;
      return 0;
    });

    // Daftarkan URL soal ke backend -> short_id (callback_data ≤64 byte)
    const soalUrls = enriched.map(t => t.file_soal_url).filter(Boolean).slice(0, 6);
    let soalMap = {};
    if (soalUrls.length > 0) {
      const mapRes = await safeFetchJson(`${backendUrl}/v1/elearning/soal-map`, {
        method: 'POST',
        headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: soalUrls })
      });
      if (mapRes.ok && mapRes.data?.data?.map) soalMap = mapRes.data.data.map;
    }

    let out = `📝 *DAFTAR TUGAS E-LEARNING AKTIF (${enriched.length} Tugas)*\n━━━━━━━━━━━━━━━━━━━━\n\n`;
    const keyboardRows = [];

    enriched.slice(0, 6).forEach((t, i) => {
      const matkul = courseMap[String(t.kode || "").toUpperCase()] || t.kode || "Mata Kuliah";
      let statusLine;
      if (t.doneGDrive) statusLine = "✅ Dikumpulkan via GDrive";
      else if (t.doneMyBest) statusLine = "✅ Terkumpul (tercatat MyBest)";
      else statusLine = "❌ Belum dikumpulkan";

      let deadlineLine = "⏳ *Batas:* -";
      if (t.deadline) {
        const sisaMs = t.deadline - Date.now();
        const sisaJam = Math.floor(sisaMs / 3600000);
        if (sisaMs < 0) deadlineLine = `⏳ *Batas:* ${t.selesai} (🔴 lewat)`;
        else if (sisaJam < 24) deadlineLine = `⏳ *Batas:* ${t.selesai} 🔥 *(${sisaJam} jam lagi!)*`;
        else deadlineLine = `⏳ *Batas:* ${t.selesai}`;
      }

      out += `*${i + 1}. ${matkul}*\n`;
      out += `   📌 *Tugas:* ${t.judul || "Tugas Pertemuan"}${t.kelas ? ` (Kelas ${t.kelas})` : ""}\n`;
      out += `   ${deadlineLine}\n`;
      out += `   📊 *Status:* ${statusLine}\n`;
      if (t.token_tugas) out += `   🔑 *Token:* \`${t.token_tugas}\`\n`;
      out += `\n`;

      const sid = soalMap[t.file_soal_url];
      if (sid) keyboardRows.push([{ text: `📥 Soal #${i + 1}`, callback_data: `dl_soal_${sid}` }]);
    });

    out += `━━━━━━━━━━━━━━━━━━━━\n` +
           `📤 *Cara Kumpul Tugas (via Google Drive):*\n` +
           `1️⃣ Upload jawaban ke Google Drive kamu\n` +
           `2️⃣ Set akses *"Anyone with the link"*\n` +
           `3️⃣ Ketik: \`/kumpul <token> <link_gdrive> [catatan]\`\n\n` +
           `_Contoh:_\n\`/kumpul ${enriched[0].token_tugas || "TOKEN123"} https://drive.google.com/file/d/... tugas pertemuan 1\` 🤍`;

    const replyMarkup = keyboardRows.length > 0 ? { inline_keyboard: keyboardRows } : null;
    await sendTelegram(botToken, chatId, out, threadId, replyMarkup);

  } catch (err) {
    await sendTelegram(botToken, chatId, `⚠️ Gagal memuat daftar tugas: ${err.message}`, threadId);
  }
}

async function handleKumpulGDrive(botToken, chatId, threadId, acc, backendUrl, apiKey, supabaseUrl, supabaseKey, text, userName) {
  const parts = text.split(/\s+/);
  // /kumpul <token> <link> [catatan...]
  if (parts.length < 3) {
    await sendTelegram(
      botToken, chatId,
      "⚠️ *Format Salah!*\n\n" +
      "`/kumpul <token_tugas> <link_gdrive> [catatan]`\n\n" +
      "*Langkah:*\n" +
      "1️⃣ Upload jawaban ke Google Drive\n" +
      "2️⃣ Klik kanan file → *Bagikan* → ubah ke *\"Anyone with the link\"*\n" +
      "3️⃣ Salin link → kirim dengan format di atas\n\n" +
      "_Lihat token aktif dengan mengetik /tugas._",
      threadId
    );
    return;
  }

  const tokenTugas = parts[1].trim();
  const driveLink = parts[2].trim();
  const catatan = parts.slice(3).join(" ") || "-";

  // 1. Validasi link Google Drive
  if (!/^https:\/\/(drive|docs)\.google\.com\//i.test(driveLink)) {
    await sendTelegram(
      botToken, chatId,
      "⚠️ *Link tidak valid!*\n\nWajib link Google Drive (`https://drive.google.com/...`).\nJangan lupa set akses *\"Anyone with the link\"* agar dosen bisa membuka.",
      threadId
    );
    return;
  }

  // 2. Validasi token + deadline
  const credHeaders = {
    'X-API-Key': apiKey,
    'X-Elearning-NIM': acc.nim,
    'X-Elearning-Pass': acc.encrypted_password,
    'X-Nim': acc.nim,
    'X-Pass': acc.encrypted_password,
  };
  const asgRes = await safeFetchJson(`${backendUrl}/v1/elearning/assignments`, { headers: credHeaders });
  const tasks = (asgRes.ok && asgRes.data?.data?.tasks) || [];
  const task = tasks.find(t => t.token_tugas === tokenTugas);

  if (!task) {
    const tokens = tasks.map(t => t.token_tugas).filter(Boolean);
    let hint = "";
    if (tokens.length > 0) hint = `\n\n*Token aktif:*\n${tokens.map(t => `• \`${t}\``).join("\n")}`;
    await sendTelegram(
      botToken, chatId,
      `⚠️ *Token tugas "${tokenTugas}" tidak ditemukan di daftar aktif MyBest.*${hint}\n\n_Cek kembali dengan mengetik /tugas._`,
      threadId
    );
    return;
  }

  const deadline = parseDeadline(task.selesai);
  const isLate = deadline ? (Date.now() > deadline.getTime()) : false;

  // 3. Simpan ke Supabase (upsert: kumpul ulang = replace versi terakhir)
  const payload = {
    telegram_user_id: acc.telegram_user_id,
    nim: acc.nim,
    full_name: acc.full_name || userName,
    token_tugas: tokenTugas,
    judul_tugas: task.judul || null,
    drive_link: driveLink,
    catatan: catatan,
    status: 'pending',
    is_late: isLate,
  };

  const upRes = await safeFetchJson(`${supabaseUrl}/rest/v1/ubsi_task_submissions`, {
    method: 'POST',
    headers: {
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates,return=representation'
    },
    body: JSON.stringify(payload)
  });

  if (!upRes.ok) {
    const errMsg = upRes.data?.message || upRes.data?.error?.message || `HTTP ${upRes.status}`;
    const hintTable = /404|not found|schema/i.test(errMsg)
      ? "\n\n_(Tabel ubsi_task_submissions belum ada — jalankan sql-add-task-submissions.sql di Supabase.)_"
      : "";
    await sendTelegram(botToken, chatId, `⚠️ Gagal menyimpan pengumpulan: ${errMsg}${hintTable}`, threadId);
    return;
  }

  const row = Array.isArray(upRes.data) ? upRes.data[0] : null;
  const subId = row ? row.id : null;

  // 4. Preview + konfirmasi
  const preview =
    `📋 *KONFIRMASI PENGUMPULAN TUGAS*\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `📌 *Tugas:* ${task.judul || tokenTugas}\n` +
    `🔑 *Token:* \`${tokenTugas}\`\n` +
    `🔗 *Link:* ${driveLink}\n` +
    `💬 *Catatan:* ${catatan}\n` +
    (deadline ? `⏳ *Deadline:* ${task.selesai}${isLate ? " 🔴 (TERLAMBAT)" : " 🟢 (masih buka)"}\n` : "") +
    `\n_Yakin ingin mengumpulkan?_`;

  const replyMarkup = subId ? {
    inline_keyboard: [[
      { text: "✅ Ya, Kumpulkan Sekarang", callback_data: `kumpul_ok_${subId}` },
      { text: "❌ Batal", callback_data: `kumpul_no_${subId}` }
    ]]
  } : null;

  if (!subId) {
    // Tidak dapat id (mis. duplikat tanpa upsert) -> langsung anggap sukses tersimpan
    await sendTelegram(botToken, chatId, `✅ *Pengumpulan tugas tercatat.* Token: \`${tokenTugas}\``, threadId);
    return;
  }

  await sendTelegram(botToken, chatId, preview, threadId, replyMarkup);
}

async function handleDownloadFile(botToken, chatId, threadId, acc, backendUrl, apiKey, fileUrl, datacenterChatId, title = "Dokumen", course = "") {
  try {
    const dlRes = await fetch(`${backendUrl}/v1/elearning/assignments/download?file_url=${encodeURIComponent(fileUrl)}`, {
      headers: {
        'X-API-Key': apiKey,
        'X-Elearning-NIM': acc.nim,
        'X-Elearning-Pass': acc.encrypted_password,
        'X-Nim': acc.nim,
        'X-Pass': acc.encrypted_password,
      }
    });

    if (!dlRes.ok) return false;
    const buf = await dlRes.arrayBuffer();
    if (buf.byteLength < 500) return false;

    const safeTitle = title.replace(/[^\w\s.\-()]/g, '').trim().slice(0, 50) || 'berkas';
    const filename = safeTitle.endsWith('.pdf') ? safeTitle : `${safeTitle}.pdf`;

    const form = new FormData();
    form.append('chat_id', String(chatId));
    if (threadId) form.append('message_thread_id', String(threadId));
    form.append('caption', `📄 *${title}*` + (course ? `\n📚 Matkul: ${course}` : "") + `\n\n_Diunduh via USRC Bot Gudang_ 🤍`);
    form.append('document', new Blob([buf], { type: 'application/pdf' }), filename);

    const sd = await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, {
      method: 'POST',
      body: form
    });
    const sdJson = await sd.json().catch(() => ({ ok: false }));

    // Auto-Mirror ke DATACENTER USRC
    if (datacenterChatId && sdJson.ok && sdJson.result) {
      await fetch(`https://api.telegram.org/bot${botToken}/forwardMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: datacenterChatId,
          from_chat_id: chatId,
          message_id: sdJson.result.message_id
        })
      });
    }

    return true;
  } catch (_) {
    return false;
  }
}

// ── UTILITY FUNCTIONS ──

function collectFileUrls(node, courseName, out) {
  if (!node) return;
  if (typeof node === 'string') {
    if (/storage\/(soal|tugas|learning)|\.(pdf|pptx?|docx?|zip|rar)(\?|$)/i.test(node)) {
      out.push({ url: node, title: node.split('/').pop() || 'materi', course: courseName });
    }
    return;
  }
  if (Array.isArray(node)) { node.forEach(x => collectFileUrls(x, courseName, out)); return; }
  if (typeof node === 'object') {
    // Backend parse_materials memakai field "judul" (bukan "title")
    let title = null;
    if (typeof node.judul === 'string' && node.judul.trim()) title = node.judul.trim();
    else if (typeof node.title === 'string' && node.title.trim()) title = node.title.trim();
    Object.values(node).forEach(v => {
      if (typeof v === 'string') {
        if (/storage\/(soal|tugas|learning)|\.(pdf|pptx?|docx?|zip|rar)(\?|$)/i.test(v)) {
          out.push({ url: v, title: title || v.split('/').pop() || 'materi', course: courseName });
        }
      } else {
        collectFileUrls(v, courseName, out);
      }
    });
  }
}

async function getStudentAccount(supabaseUrl, supabaseKey, telegramUserId) {
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/ubsi_accounts?telegram_user_id=eq.${telegramUserId}&select=*`, {
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`
      }
    });
    const rows = await res.json();
    return (rows && rows.length > 0) ? rows[0] : null;
  } catch {
    return null;
  }
}

async function safeFetchJson(url, options) {
  try {
    const res = await fetch(url, options);
    const text = await res.text();
    try {
      return { ok: res.ok, status: res.status, data: JSON.parse(text) };
    } catch (_) {
      return { ok: false, status: res.status, raw: text };
    }
  } catch (err) {
    return { ok: false, status: 0, error: err.message };
  }
}

async function deleteMessage(token, chatId, messageId) {
  await fetch(`https://api.telegram.org/bot${token}/deleteMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId })
  }).catch(() => {});
}

async function sendTelegram(token, chatId, text, threadId = null, replyMarkup = null) {
  const payload = {
    chat_id: chatId,
    text: text,
    parse_mode: 'Markdown'
  };
  if (threadId) payload.message_thread_id = threadId;
  if (replyMarkup) payload.reply_markup = replyMarkup;

  const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  let j = await resp.json().catch(() => ({ ok: false }));

  // Fallback: kalau Markdown ditolak, kirim polos
  if (!j.ok && payload.parse_mode) {
    delete payload.parse_mode;
    const r2 = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    j = await r2.json().catch(() => ({ ok: false }));
  }
  return j;
}

async function answerCallback(token, queryId, text = null) {
  const payload = { callback_query_id: queryId };
  if (text) payload.text = text;
  await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}
