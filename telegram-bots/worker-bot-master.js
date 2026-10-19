/**
 * USRC BOT MASTER (Hub / DM Frontdesk)
 * Menangani:
 * 1. Private Chat (DM) untuk /start dan /login <nim> <password>
 * 2. Simpan kredensial mahasiswa ke Supabase (tabel ubsi_accounts)
 * 3. Kirim laporan rahasia (notifikasi absen, nilai, dan statistik IPK)
 */

export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'POST') {
      return new Response('USRC Master Bot Active', { status: 200 });
    }

    try {
      const update = await request.json();
      const botToken = env.BOT_TOKEN_MASTER;
      const backendUrl = (env.BACKEND_URL || 'https://ubsi-api-production.up.railway.app').replace(/\/$/, '');
      const apiKey = env.BACKEND_API_KEY || 'usrc_secret_2026';
      const supabaseUrl = env.SUPABASE_URL || 'https://wagvbmkimpswiidnenwx.supabase.co';
      const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;

      if (!update.message) return new Response('OK', { status: 200 });

      const msg = update.message;
      const chatId = msg.chat.id;
      const text = (msg.text || '').trim();
      const isPrivate = msg.chat.type === 'private';

      // ── HANYA LAYANI CHAT PRIBADI (DM) ──
      if (!isPrivate) {
        return new Response('OK', { status: 200 });
      }

      // Perintah /start
      if (text.startsWith('/start')) {
        const welcomeText = 
          "🎓 *Halo Mahasiswa USRC!*\n\n" +
          "Aku adalah *Bot Master USRC* — pusat kendali dan akun akademik kampusmu.\n\n" +
          "Untuk mulai menggunakan bot otomatisasi di grup USRC (Absensi, Cek Nilai, dll), hubungkan akun kampusmu sekali di sini:\n\n" +
          "👉 Ketik: `/login <NIM> <PASSWORD_MYBEST>`\n" +
          "Contoh: `/login 15260124 Rahasia123`\n\n" +
          "🔒 *Privasi Aman:* Kredensialmu hanya disimpan di database privat USRC untuk eksekusi layanan akademik resmi.";

        await sendTelegram(botToken, chatId, welcomeText);
        return new Response('OK', { status: 200 });
      }

      // Perintah /login <nim> <pass>
      if (text.startsWith('/login')) {
        const parts = text.split(/\s+/);
        if (parts.length < 3) {
          await sendTelegram(botToken, chatId, "⚠️ *Format Salah!*\n\nGunakan format:\n`/login <NIM> <PASSWORD>`\n\nContoh:\n`/login 15260124 Rahasia123`");
          return new Response('OK', { status: 200 });
        }

        const nim = parts[1].trim();
        const password = parts.slice(2).join(' ').trim();

        await sendTelegram(botToken, chatId, "⏳ *Sedang memverifikasi kredensial ke sistem kampus...*");

        // 1. Verifikasi kredensial ke Backend UBSI-API
        let isValid = false;
        let studentName = "Mahasiswa";
        let prodi = "-";

        try {
          const authRes = await fetch(`${backendUrl}/v1/studentv2/profile`, {
            headers: {
              'X-API-Key': apiKey,
              'X-StudentV2-NIM': nim,
              'X-StudentV2-Pass': password,
              'X-Nim': nim,
              'X-Pass': password,
            }
          });
          const authData = await authRes.json();
          if (authData.success && authData.data) {
            isValid = true;
            studentName = authData.data.nama || authData.data.full_name || "Mahasiswa";
            prodi = authData.data.prodi || "-";
          }
        } catch (e) {
          // Fallback coba login ke MyBest jika StudentV2 down
          try {
            const elRes = await fetch(`${backendUrl}/v1/elearning/courses`, {
              headers: {
                'X-API-Key': apiKey,
                'X-Elearning-NIM': nim,
                'X-Elearning-Pass': password,
                'X-Nim': nim,
                'X-Pass': password,
              }
            });
            const elData = await elRes.json();
            if (elData.success) isValid = true;
          } catch (err) {}
        }

        if (!isValid) {
          await sendTelegram(botToken, chatId, "❌ *Verifikasi Gagal!*\n\nNIM atau Password salah / akun kampus tidak dapat diakses saat ini. Pastikan akun MyBest/SIAKAD aktif.");
          return new Response('OK', { status: 200 });
        }

        // 2. Simpan ke Supabase tabel ubsi_accounts
        try {
          const upsertRes = await fetch(`${supabaseUrl}/rest/v1/ubsi_accounts`, {
            method: 'POST',
            headers: {
              'apikey': supabaseKey,
              'Authorization': `Bearer ${supabaseKey}`,
              'Content-Type': 'application/json',
              'Prefer': 'resolution=merge-duplicates'
            },
            body: JSON.stringify({
              telegram_user_id: chatId,
              nim: nim,
              encrypted_password: password, // Bisa dienkripsi AES simetris di sisi DB/Worker
              full_name: studentName,
              prodi: prodi,
              is_active: true,
              updated_at: new Date().toISOString()
            })
          });

          if (!upsertRes.ok) throw new Error("Gagal menyimpan ke database Supabase");

          await sendTelegram(
            botToken,
            chatId,
            `✅ *Akun Berhasil Terhubung!*\n\n` +
            `• *Nama:* ${studentName}\n` +
            `• *NIM:* ${nim}\n` +
            `• *Prodi:* ${prodi}\n\n` +
            `Sekarang kamu sudah bisa menggunakan fitur presensi di topik *E-Learning & Absen* dan cek nilai di topik *Statistik* di grup USRC!`
          );
        } catch (dbErr) {
          await sendTelegram(botToken, chatId, `⚠️ Gagal menyimpan akun ke database USRC: ${dbErr.message}`);
        }

        return new Response('OK', { status: 200 });
      }

      // Perintah tidak dikenal di DM
      await sendTelegram(botToken, chatId, "Ketik `/start` untuk panduan atau `/login <NIM> <PASSWORD>` untuk hubungkan akun.");
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
  };
  if (threadId) payload.message_thread_id = threadId;
  if (replyMarkup) payload.reply_markup = replyMarkup;

  return await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}
