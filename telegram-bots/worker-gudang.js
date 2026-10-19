/**
 * USRC BOT GUDANG MATERI (Perpustakaan & Repository)
 * Menangani di Topik Grup:
 * 1. /buku <kata kunci>  -> Cari buku di katalog OPAC Perpustakaan BSI
 * 2. /cari <kata kunci>  -> Cari skripsi / TA di EPrints Repository BSI
 * 3. /jurnal             -> Katalog e-journal resmi kampus
 */

export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'POST') {
      return new Response('USRC Gudang Materi Bot Active', { status: 200 });
    }

    try {
      const update = await request.json();
      const botToken = env.BOT_TOKEN_GUDANG;
      const backendUrl = (env.BACKEND_URL || 'https://ubsi-api-production.up.railway.app').replace(/\/$/, '');
      const apiKey = env.BACKEND_API_KEY || 'usrc_secret_2026';

      if (!update.message) return new Response('OK', { status: 200 });

      const msg = update.message;
      const chatId = msg.chat.id;
      const threadId = msg.message_thread_id || null;
      const text = (msg.text || '').trim();

      // ── 1. CARI BUKU PERPUSTAKAAN OPAC (/buku <keyword>) ──
      if (text.startsWith('/buku')) {
        const query = text.replace(/^\/buku(@\w+)?/, '').trim();
        if (!query) {
          await sendTelegram(botToken, chatId, "📚 *Gudang Perpustakaan USRC*\n\nKetik `/buku <judul atau topik>`\nContoh: `/buku python` atau `/buku sistem operasi`", threadId);
          return new Response('OK', { status: 200 });
        }

        await sendTelegram(botToken, chatId, `🔍 *Mencari buku OPAC dengan kata kunci:* _"${query}"_...`, threadId);

        try {
          const res = await fetch(`${backendUrl}/v1/elibrary/search?q=${encodeURIComponent(query)}`, {
            headers: { 'X-API-Key': apiKey }
          });
          const json = await res.json();

          if (!json.success || !json.data || !json.data.items || json.data.items.length === 0) {
            await sendTelegram(botToken, chatId, `⚠️ Tidak ditemukan buku dengan kata kunci _"${query}"_ di perpustakaan kampus.`, threadId);
            return new Response('OK', { status: 200 });
          }

          const items = json.data.items.slice(0, 5); // Tampilkan top 5 buku
          let out = `📚 *HASIL KATALOG PERPUSTAKAAN (${json.data.total_count} Ditemukan):*\n\n`;

          items.forEach((b, idx) => {
            out += `${idx + 1}. *${b.title}*\n`;
            if (b.url) out += `   📖 [Akses / Baca Buku](${b.url})\n`;
            out += `\n`;
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

        await sendTelegram(botToken, chatId, `🔍 *Mencari repositori riset dengan kata kunci:* _"${query}"_...`, threadId);

        try {
          const res = await fetch(`${backendUrl}/v1/repository/search?q=${encodeURIComponent(query)}`, {
            headers: { 'X-API-Key': apiKey }
          });
          const json = await res.json();

          if (!json.success || !json.data || json.data.length === 0) {
            await sendTelegram(botToken, chatId, `⚠️ Tidak ditemukan dokumen riset untuk kata kunci _"${query}"_.`, threadId);
            return new Response('OK', { status: 200 });
          }

          const items = json.data.slice(0, 5);
          let out = `🎓 *HASIL REPOSITORI KAMPUS UBSI:*\n\n`;

          items.forEach((r, idx) => {
            out += `${idx + 1}. *${r.title}*\n`;
            if (r.author) out += `   👤 Penulis: ${r.author}\n`;
            if (r.year) out += `   📅 Tahun: ${r.year}\n`;
            if (r.url) out += `   📄 [Buka Dokumen / PDF](${r.url})\n`;
            out += `\n`;
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
            out += `${idx + 1}. *${j.title}*\n   🔗 [Kunjungi Portal](${j.url})\n\n`;
          });

          await sendTelegram(botToken, chatId, out, threadId);
        } catch (err) {
          await sendTelegram(botToken, chatId, `❌ Gagal mengambil e-journal: ${err.message}`, threadId);
        }

        return new Response('OK', { status: 200 });
      }

      return new Response('OK', { status: 200 });

    } catch (err) {
      return new Response('Error: ' + err.message, { status: 500 });
    }
  }
};

async function sendTelegram(token, chatId, text, threadId = null, replyMarkup = null) {
  const payload = {
    chat_id: chatId,
    text: text,
    parse_mode: 'Markdown',
    disable_web_page_preview: true,
  };
  if (threadId) payload.message_thread_id = threadId;
  if (replyMarkup) payload.reply_markup = replyMarkup;

  return await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}
