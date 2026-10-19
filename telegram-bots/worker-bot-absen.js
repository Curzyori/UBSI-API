/**
 * USRC BOT ABSENSI (E-Learning & Presensi MyBest)
 * Menangani di Topik Grup:
 * 1. Tombol menu interaktif: [ ⚡ Absen Sekarang ] & [ 📋 Jadwal Hari Ini ]
 * 2. Eksekusi presensi otomatis via backend UBSI-API
 * 3. Kirim status publik ke topik + bukti lengkap ke DM via Bot Master
 */

export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'POST') {
      return new Response('USRC Absen Bot Active', { status: 200 });
    }

    try {
      const update = await request.json();
      const botToken = env.BOT_TOKEN_ABSEN;
      const masterBotToken = env.BOT_TOKEN_MASTER;
      const backendUrl = (env.BACKEND_URL || 'https://ubsi-api-production.up.railway.app').replace(/\/$/, '');
      const apiKey = env.BACKEND_API_KEY || 'usrc_secret_2026';
      const supabaseUrl = env.SUPABASE_URL || 'https://wagvbmkimpswiidnenwx.supabase.co';
      const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;

      // ── 1. HANDLE TOMBOL KLIK (Callback Query) ──
      if (update.callback_query) {
        const query = update.callback_query;
        const cbData = query.data;
        const userId = query.from.id;
        const userName = query.from.first_name || "Mahasiswa";
        const chatId = query.message.chat.id;
        const threadId = query.message.message_thread_id || null;

        // ── KUNCI SATPAM TOPIK ABSEN (Thread ID: 4) ──
        const isGroup = query.message.chat.type === 'group' || query.message.chat.type === 'supergroup';
        if (isGroup && Number(threadId) !== 4) {
          await answerCallback(botToken, query.id, "Fitur ini hanya aktif di Topik E-Learning & Absen!");
          return new Response('OK', { status: 200 });
        }

        // Ambil akun mahasiswa dari Supabase
        const acc = await getStudentAccount(supabaseUrl, supabaseKey, userId);

        if (!acc) {
          await answerCallback(botToken, query.id, "Akun belum terhubung! Silakan chat Bot Master untuk login terlebih dahulu.");
          return new Response('OK', { status: 200 });
        }

        if (cbData === "btn_absen_now") {
          await answerCallback(botToken, query.id, "Sedang memproses presensi ke MyBest...");

          try {
            // Panggil backend UBSI-API untuk submit presensi sesi aktif
            const res = await fetch(`${backendUrl}/v1/elearning/presence/submit`, {
              method: 'POST',
              headers: {
                'X-API-Key': apiKey,
                'X-Elearning-NIM': acc.nim,
                'X-Elearning-Pass': acc.encrypted_password,
                'X-Nim': acc.nim,
                'X-Pass': acc.encrypted_password,
              }
            });
            const presData = await res.json();

            if (presData.success) {
              const mkName = presData.data?.matakuliah || "Kuliah Hari Ini";
              const dosen = presData.data?.dosen || "-";

              // 1. Notif Ringkas di Topik Grup
              await sendTelegram(
                botToken,
                chatId,
                `✅ *Presensi Berhasil!*\n\n• Mahasiswa: *${userName}*\n• Matkul: *${mkName}*\n• Status: *Hadir di MyBest* ⚡`,
                threadId
              );

              // 2. Bukti Detail dikirim ke DM Mahasiswa via Bot Master
              if (masterBotToken) {
                await sendTelegram(
                  masterBotToken,
                  userId,
                  `🎓 *BUKTI PRESENSI ELEARNING BERHASIL*\n\n` +
                  `• Nama: *${acc.full_name || userName}*\n` +
                  `• NIM: *${acc.nim}*\n` +
                  `• Mata Kuliah: *${mkName}*\n` +
                  `• Dosen: *${dosen}*\n` +
                  `• Waktu Absen: *${new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Pontianak' })} WIB*\n\n` +
                  `Status kehadiranmu sudah tercatat resmi di portal MyBest kampus! 🤍`
                );
              }
            } else {
              const msgErr = presData.error?.message || presData.data?.message || "Tidak ada sesi kuliah yang sedang membuka presensi saat ini.";
              await sendTelegram(
                botToken,
                chatId,
                `⚠️ *Gagal Absen (${userName}):*\n${msgErr}`,
                threadId
              );
            }
          } catch (err) {
            await sendTelegram(botToken, chatId, `❌ Terjadi kesalahan sistem: ${err.message}`, threadId);
          }

          return new Response('OK', { status: 200 });
        }

        if (cbData === "btn_jadwal_today") {
          await answerCallback(botToken, query.id, "Mengambil jadwal kuliah...");

          try {
            const schRes = await fetch(`${backendUrl}/v1/studentv2/schedule`, {
              headers: {
                'X-API-Key': apiKey,
                'X-StudentV2-NIM': acc.nim,
                'X-StudentV2-Pass': acc.encrypted_password,
                'X-Nim': acc.nim,
                'X-Pass': acc.encrypted_password,
              }
            });
            const schData = await schRes.json();

            if (!schData.success || !schData.data || schData.data.length === 0) {
              await sendTelegram(botToken, chatId, `📋 Tidak ada jadwal kuliah terdaftar untuk NIM *${acc.nim}*.`, threadId);
              return new Response('OK', { status: 200 });
            }

            let textSch = `📋 *JADWAL KULIAH MAHASISWA (${acc.nim}):*\n\n`;
            schData.data.slice(0, 4).forEach((j, idx) => {
              textSch += `${idx + 1}. *${j.matakuliah || j.nama_mata_kuliah}*\n`;
              textSch += `   ⏰ ${j.hari || '-'}, ${j.jam || j.waktu || '-'} (Ruang: ${j.ruang || '-'})\n\n`;
            });

            await sendTelegram(botToken, chatId, textSch, threadId);
          } catch (err) {
            await sendTelegram(botToken, chatId, `❌ Gagal mengambil jadwal: ${err.message}`, threadId);
          }

          return new Response('OK', { status: 200 });
        }
      }

      // ── 2. HANDLE PESAN / COMMAND DI TOPIK ──
      if (update.message) {
        const msg = update.message;
        const chatId = msg.chat.id;
        const threadId = msg.message_thread_id || null;
        const text = (msg.text || '').trim();

        // ── KUNCI SATPAM TOPIK ABSEN (Thread ID: 4) ──
        const isGroup = msg.chat.type === 'group' || msg.chat.type === 'supergroup';
        if (isGroup && Number(threadId) !== 4) {
          return new Response('Ignored out-of-topic message', { status: 200 });
        }

        if (text.startsWith('/absen') || text.startsWith('/menu')) {
          const menuText = 
            "⚡ *PORTAL PRESENSI ELEARNING USRC*\n\n" +
            "Pastikan akunmu sudah login di DM Bot Master. Klik tombol di bawah untuk eksekusi cepat:";

          const keyboard = {
            inline_keyboard: [
              [
                { text: "⚡ Absen Kelas Sekarang", callback_data: "btn_absen_now" }
              ],
              [
                { text: "📋 Cek Jadwal Kuliah", callback_data: "btn_jadwal_today" }
              ]
            ]
          };

          await sendTelegram(botToken, chatId, menuText, threadId, keyboard);
          return new Response('OK', { status: 200 });
        }
      }

      return new Response('OK', { status: 200 });

    } catch (err) {
      return new Response('Error: ' + err.message, { status: 500 });
    }
  }
};

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

async function sendTelegram(token, chatId, text, threadId = null, replyMarkup = null) {
  const payload = {
    chat_id: chatId,
    text: text,
    parse_mode: 'Markdown',
  };
  if (threadId) payload.message_thread_id = threadId;
  if (replyMarkup) payload.reply_markup = replyMarkup;

  return await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

async function answerCallback(token, queryId, text) {
  await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: queryId, text: text })
  });
}
