/**
 * USRC BOT GUDANG MATERI v2.0 (Perpustakaan, Repository, Materi, & Ruang Tugas MyBest)
 * Menangani di Topik Grup (Thread ID: 7) & DM:
 * 1. /buku <kata kunci>     -> Katalog OPAC Perpustakaan BSI
 * 2. /cari <kata kunci>     -> Skripsi / TA di EPrints Repository BSI
 * 3. /jurnal                -> Katalog e-journal resmi kampus
 * 4. /materi <kata kunci>   -> Slide/PDF materi MyBest, dikirim sebagai FILE + mirror ke DATACENTER
 * 5. /tugas                 -> List tugas aktif MyBest + status pengumpulan + tombol unduh soal
 * 6. Upload Dokumen Tugas   -> Kirim file (PDF/ZIP/DOCX) dgn caption `/kumpul <token_tugas> [catatan]`
 */

export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'POST') {
      return new Response('USRC Gudang Materi Bot v2.0 Active', { status: 200 });
    }

    try {
      const update = await request.json();
      const botToken = env.BOT_TOKEN_GUDANG;
      const masterBotToken = env.BOT_TOKEN_MASTER;
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
          await handleListTugas(botToken, chatId, threadId, acc, backendUrl, apiKey);
          return new Response('OK', { status: 200 });
        }

        if (cbData.startsWith("dl_soal_")) {
          const rawUrl = atob(cbData.replace("dl_soal_", ""));
          await answerCallback(botToken, query.id, "Mengunduh berkas soal tugas...");
          await handleDownloadFile(botToken, chatId, threadId, acc, backendUrl, apiKey, rawUrl, datacenterChatId, "Soal Tugas");
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
      const caption = (msg.caption || '').trim();
      const userId = msg.from.id;
      const userName = msg.from.first_name || "Mahasiswa";

      // ── KUNCI SATPAM TOPIK GUDANG MATERI (Thread ID: 7) ──
      const isGroup = msg.chat.type === 'group' || msg.chat.type === 'supergroup';
      if (isGroup && Number(threadId) !== 7) {
        return new Response('Ignored out-of-topic message', { status: 200 });
      }

      // ── A. TANGANI UPLOAD FILE TUGAS (msg.document) ──
      if (msg.document) {
        const fullPrompt = caption || text;
        if (fullPrompt.includes('/kumpul')) {
          const acc = await getStudentAccount(supabaseUrl, supabaseKey, userId);
          if (!acc) {
            await sendTelegram(botToken, chatId, "🔒 Upload tugas memerlukan akun MyBest. Login dulu di DM *Bot Master*.", threadId);
            return new Response('OK', { status: 200 });
          }

          const parts = fullPrompt.replace(/^\/kumpul(@\w+)?/, '').trim().split(/\s+/);
          const tokenTugas = parts[0];
          const catatan = parts.slice(1).join(' ') || "Dikumpulkan via USRC Bot Telegram";

          if (!tokenTugas) {
            await sendTelegram(
              botToken, 
              chatId, 
              "⚠️ Format upload salah! Kirim dokumen dengan caption:\n`/kumpul <token_tugas> [catatan opsional]`\n\n_Lihat token tugas dengan mengetik /tugas._", 
              threadId
            );
            return new Response('OK', { status: 200 });
          }

          await handleUploadTugas(botToken, chatId, threadId, acc, backendUrl, apiKey, msg.document, tokenTugas, catatan);
          return new Response('OK', { status: 200 });
        }
      }

      // ── B. RUANG TUGAS MYBEST (/tugas) ──
      if (text.startsWith('/tugas')) {
        const acc = await getStudentAccount(supabaseUrl, supabaseKey, userId);
        if (!acc) {
          await sendTelegram(botToken, chatId, "🔒 Ruang tugas memerlukan akun MyBest. Login dulu di DM *Bot Master* dengan `/login <NIM> <PASSWORD>`.", threadId);
          return new Response('OK', { status: 200 });
        }

        await sendTelegram(botToken, chatId, `⏳ *Mengambil daftar tugas kuliah aktif untuk ${userName}...*`, threadId);
        await handleListTugas(botToken, chatId, threadId, acc, backendUrl, apiKey);
        return new Response('OK', { status: 200 });
      }

      // ── C. CARI BUKU PERPUSTAKAAN OPAC (/buku <keyword>) ──
      if (text.startsWith('/buku')) {
        const query = text.replace(/^\/buku(@\w+)?/, '').trim();
        if (!query) {
          await sendTelegram(botToken, chatId, "📚 *Gudang Perpustakaan USRC*\n\nKetik `/buku <judul atau topik>`\nContoh: `/buku python` atau `/buku sistem operasi`", threadId);
          return new Response('OK', { status: 200 });
        }

        await sendTelegram(botToken, chatId, `🔍 Mencari buku OPAC: "${query}"...`, threadId);

        try {
          const res = await fetch(`${backendUrl}/v1/elibrary/search?q=${encodeURIComponent(query)}`, {
            headers: { 'X-API-Key': apiKey }
          });
          const json = await res.json();

          if (!json.success || !json.data || !json.data.items || json.data.items.length === 0) {
            await sendTelegram(botToken, chatId, `⚠️ Tidak ditemukan buku dengan kata kunci "${query}" di perpustakaan kampus.`, threadId);
            return new Response('OK', { status: 200 });
          }

          const items = json.data.items.slice(0, 5);
          let out = `📚 *KATALOG PERPUSTAKAAN (${json.data.total_count} ditemukan):*\n\n`;

          items.forEach((b, idx) => {
            out += `${idx + 1}. *${b.title}*\n`;
            if (b.url) out += `   📖 [Baca Buku](${b.url})\n\n`;
          });

          out += `_Menampilkan ${items.length} hasil teratas._`;
          await sendTelegram(botToken, chatId, out, threadId);

        } catch (err) {
          await sendTelegram(botToken, chatId, `❌ Gagal mengambil data perpustakaan: ${err.message}`, threadId);
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
          await sendTelegram(botToken, chatId, `❌ Gagal mengambil materi: ${err.message}`, threadId);
        }

        return new Response('OK', { status: 200 });
      }

      // Menu default topik
      if (text.startsWith('/menu') || text.startsWith('/start')) {
        const menuText = 
          "📚 *GUDANG MATERI & RUANG TUGAS USRC v2.0*\n\n" +
          "Akses seluruh pustaka akademik dan tugas E-Learning MyBest langsung dari Telegram:\n\n" +
          "• `/tugas` — Cek daftar tugas aktif & kumpul tugas\n" +
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

async function handleListTugas(botToken, chatId, threadId, acc, backendUrl, apiKey) {
  try {
    const res = await fetch(`${backendUrl}/v1/elearning/assignments`, {
      headers: {
        'X-API-Key': apiKey,
        'X-Elearning-NIM': acc.nim,
        'X-Elearning-Pass': acc.encrypted_password,
        'X-Nim': acc.nim,
        'X-Pass': acc.encrypted_password,
      }
    });

    const json = await res.json();
    if (!json.success || !json.data) {
      throw new Error(json.error?.message || "Gagal membuka data ruang tugas.");
    }

    const tasks = json.data.tasks || [];
    if (tasks.length === 0) {
      await sendTelegram(botToken, chatId, "🎉 *Tidak ada tugas aktif di MyBest saat ini.* Waktunya santai atau riset!", threadId);
      return;
    }

    let out = `📝 *DAFTAR TUGAS E-LEARNING AKTIF (${tasks.length} Tugas)*\n━━━━━━━━━━━━━━━━━━━━\n\n`;
    const keyboardRows = [];

    tasks.slice(0, 6).forEach((t, i) => {
      const isDone = (t.status || '').toLowerCase().includes('sudah') || (t.status || '').toLowerCase().includes('selesai');
      const statusIcon = isDone ? "✅ Selesai" : "❌ Belum Dikumpulkan";

      out += `*${i + 1}. ${t.mata_kuliah || t.kode || 'Mata Kuliah'}*\n`;
      out += `   📌 *Tugas:* ${t.tugas || t.nama || 'Tugas Pertemuan'}\n`;
      out += `   ⏳ *Batas:* ${t.batas_waktu || '-'}\n`;
      out += `   📊 *Status:* ${statusIcon}\n`;
      if (t.token_tugas) out += `   🔑 *Token:* \`${t.token_tugas}\`\n`;
      out += `\n`;

      const buttons = [];
      if (t.download_url) {
        const b64 = btoa(t.download_url);
        buttons.push({ text: `📥 Soal #${i + 1}`, callback_data: `dl_soal_${b64}` });
      }
      if (buttons.length > 0) keyboardRows.push(buttons);
    });

    out += `━━━━━━━━━━━━━━━━━━━━\n` +
           `📤 *Cara Kumpul Tugas Langsung:*\n` +
           `Kirimkan file jawaban Anda (.pdf, .zip, .docx) dengan caption:\n` +
           `\`/kumpul <token_tugas> [catatan]\`\n\n` +
           `_Contoh: Kirim file PDF dengan caption:_\n\`/kumpul TUGAS123 ini jawaban saya pak\` 🤍`;

    const replyMarkup = keyboardRows.length > 0 ? { inline_keyboard: keyboardRows } : null;
    await sendTelegram(botToken, chatId, out, threadId, replyMarkup);

  } catch (err) {
    await sendTelegram(botToken, chatId, `⚠️ Gagal memuat daftar tugas: ${err.message}`, threadId);
  }
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

async function handleUploadTugas(botToken, chatId, threadId, acc, backendUrl, apiKey, doc, tokenTugas, catatan) {
  await sendTelegram(botToken, chatId, `⏳ *Sedang mengunggah berkas "${doc.file_name}" ke portal MyBest...*`, threadId);

  try {
    // 1. Ambil direct file path dari Telegram
    const fileRes = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${doc.file_id}`);
    const fileJson = await fileRes.json();
    if (!fileJson.ok || !fileJson.result?.file_path) {
      throw new Error("Gagal mengunduh berkas dari server Telegram.");
    }

    const filePath = fileJson.result.file_path;
    const dlFile = await fetch(`https://api.telegram.org/file/bot${botToken}/${filePath}`);
    const arrayBuf = await dlFile.arrayBuffer();

    if (arrayBuf.byteLength > 10 * 1024 * 1024) {
      throw new Error("Ukuran berkas melebihi batas 10 MB.");
    }

    // 2. Encode to Base64 secara chunked
    const base64Str = arrayBufferToBase64(arrayBuf);

    // 3. Post ke endpoint backend MyBest
    const submitRes = await fetch(`${backendUrl}/v1/elearning/assignments/upload`, {
      method: 'POST',
      headers: {
        'X-API-Key': apiKey,
        'X-Elearning-NIM': acc.nim,
        'X-Elearning-Pass': acc.encrypted_password,
        'X-Nim': acc.nim,
        'X-Pass': acc.encrypted_password,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        token_tugas: tokenTugas,
        filename: doc.file_name,
        file_base64: base64Str,
        catatan: catatan
      })
    });

    const submitJson = await submitRes.json();
    if (!submitRes.ok || !submitJson.success) {
      throw new Error(submitJson.error?.message || "Portal MyBest menolak berkas submission.");
    }

    const successText = 
      `🎉 *TUGAS BERHASIL DIKUMPULKAN!*\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `👤 *Mahasiswa:* ${acc.full_name || 'Mahasiswa'} (\`${acc.nim}\`)\n` +
      `📄 *Nama Berkas:* \`${doc.file_name}\`\n` +
      `🔑 *Token Tugas:* \`${tokenTugas}\`\n` +
      `💬 *Catatan:* ${catatan}\n\n` +
      `✅ _Berkas telah tersimpan dan terverifikasi di portal MyBest BSI._ 🤍`;

    await sendTelegram(botToken, chatId, successText, threadId);

  } catch (err) {
    await sendTelegram(botToken, chatId, `❌ Gagal mengunggah tugas: ${err.message}`, threadId);
  }
}

// ── UTILITY FUNCTIONS ──

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const CHUNK_SIZE = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK_SIZE));
  }
  return btoa(binary);
}

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
    let title = null;
    if (typeof node.title === 'string') title = node.title;
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
    parse_mode: 'Markdown',
    disable_web_page_preview: true,
  };
  if (threadId) payload.message_thread_id = threadId;
  if (replyMarkup) payload.reply_markup = replyMarkup;

  const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  let j = await resp.json().catch(() => ({ ok: false }));

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
