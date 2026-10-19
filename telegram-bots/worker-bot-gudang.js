/**
 * USRC BOT GUDANG MATERI (Perpustakaan & Repository & Materi MyBest)
 * Menangani di Topik Grup:
 * 1. /buku <kata kunci>   -> Katalog OPAC Perpustakaan BSI
 * 2. /cari <kata kunci>   -> Skripsi / TA di EPrints Repository BSI
 * 3. /jurnal              -> Katalog e-journal resmi kampus
 * 4. /materi <kata kunci> -> Slide/PDF materi MyBest, dikirim sebagai FILE + mirror ke DATACENTER
 */

export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'POST') {
      return new Response('USRC Gudang Materi Bot Active', { status: 200 });
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

      if (!update.message) return new Response('OK', { status: 200 });

      const msg = update.message;
      const chatId = msg.chat.id;
      const threadId = msg.message_thread_id || null;
      const text = (msg.text || '').trim();

      // ── KUNCI SATPAM TOPIK GUDANG MATERI (Thread ID: 7) ──
      // DM tetap dilayani; di grup hanya topik 7
      const isGroup = msg.chat.type === 'group' || msg.chat.type === 'supergroup';
      if (isGroup && Number(threadId) !== 7) {
        return new Response('Ignored out-of-topic message', { status: 200 });
      }

      // ── 1. CARI BUKU PERPUSTAKAAN OPAC (/buku <keyword>) ──
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

      // ── 2. CARI SKRIPSI / TA / MAKALAH EPRINTS (/cari <keyword>) ──
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

      // ── 3. KATALOG JURNAL ILMIAH (/jurnal) ──
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

      // ── 4. SLIDE MATERI MYBEST (/materi <keyword>) — kirim FILE langsung ──
      if (text.startsWith('/materi')) {
        const query = text.replace(/^\/materi(@\w+)?/, '').trim().toLowerCase();
        if (!query) {
          await sendTelegram(botToken, chatId, "📗 *Materi Kuliah MyBest*\n\nKetik `/materi <kata kunci>`\nContoh: `/materi basis data`\n\nFile PDF langsung dikirim ke sini + diarsipkan di DATACENTER USRC.", threadId);
          return new Response('OK', { status: 200 });
        }

        const acc = await getStudentAccount(supabaseUrl, supabaseKey, msg.from.id);
        if (!acc) {
          await sendTelegram(botToken, chatId, "🔒 Materi butuh akun MyBest. Login dulu di DM *Bot Master* dengan `/login <NIM> <PASSWORD>`.", threadId);
          return new Response('OK', { status: 200 });
        }

        const statusMsg = await sendTelegram(botToken, chatId, `🔍 Mencari materi "${query}" di MyBest...`, threadId);
        const statusMsgId = statusMsg && statusMsg.result ? statusMsg.result.message_id : null;

        try {
          // 1. Ambil semua mata kuliah (dengan token_learning)
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

          // 2. Ambil materi tiap matkul, kumpulkan kandidat file yang cocok
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
            } catch (e) { /* lanjut matkul berikutnya */ }
          }

          const matches = files.filter(f => f.title.toLowerCase().includes(query));
          if (matches.length === 0) {
            if (statusMsgId) await deleteMessage(botToken, chatId, statusMsgId);
            await sendTelegram(botToken, chatId, `⚠️ Tidak ada materi yang cocok dengan "${query}". Coba kata kunci lain (nama matkul saja).`, threadId);
            return new Response('OK', { status: 200 });
          }

          if (statusMsgId) await deleteMessage(botToken, chatId, statusMsgId);
          await sendTelegram(botToken, chatId, `📗 Ditemukan ${matches.length} materi. Mengirim maksimal 3 file...`, threadId);

          // 3. Unduh via proxy backend (anti-SSRF, pakai sesi MyBest) lalu kirim sebagai FILE
          let sent = 0;
          for (const f of matches.slice(0, 3)) {
            try {
              const dlRes = await fetch(`${backendUrl}/v1/elearning/assignments/download?file_url=${encodeURIComponent(f.url)}`, {
                headers: {
                  'X-API-Key': apiKey,
                  'X-Elearning-NIM': acc.nim,
                  'X-Elearning-Pass': acc.encrypted_password,
                  'X-Nim': acc.nim,
                  'X-Pass': acc.encrypted_password,
                }
              });
              if (!dlRes.ok) continue;

              const buf = await dlRes.arrayBuffer();
              if (buf.byteLength < 1000) continue; // kemungkinan halaman error, bukan file

              const filename = f.title.replace(/[^\w\s.\-()]/g, '').trim().slice(0, 60) + '.pdf';
              const form = new FormData();
              form.append('chat_id', String(chatId));
              if (threadId) form.append('message_thread_id', String(threadId));
              form.append('caption', `📗 ${f.title}\n📚 Matkul: ${f.course}`);
              form.append('document', new Blob([buf], { type: 'application/pdf' }), filename);

              const sd = await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, {
                method: 'POST',
                body: form
              });
              const sdJson = await sd.json().catch(() => ({ ok: false }));
              sent++;

              // 4. Mirror ke DATACENTER USRC (arsip permanen)
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
            } catch (e) { /* lanjut file berikutnya */ }
          }

          if (sent === 0) {
            await sendTelegram(botToken, chatId, "⚠️ Materi ditemukan tapi gagal dikirim sebagai file. Coba lagi nanti.", threadId);
          }

        } catch (err) {
          await sendTelegram(botToken, chatId, `❌ Gagal mengambil materi: ${err.message}`, threadId);
        }

        return new Response('OK', { status: 200 });
      }

      return new Response('OK', { status: 200 });

    } catch (err) {
      return new Response('Error: ' + err.message, { status: 500 });
    }
  }
};

// Kumpulkan semua URL file (PDF/slide/arsip) dari struktur JSON apa pun
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
