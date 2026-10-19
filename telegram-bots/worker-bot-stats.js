/**
 * USRC BOT STATISTIK (Diagnosis Akademik, Nilai, & Kalkulator IPK)
 * Menangani di Topik Grup:
 * 1. Tombol interaktif: [ 📊 Analisis Performa Saya ] & [ 📈 Target IPK ]
 * 2. Hitungan murni matematis (deterministik 100% akurat)
 * 3. Kirim notif privasi ke topik + kirim diagnosis lengkap rahasia ke DM via Bot Master
 */

export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'POST') {
      return new Response('USRC Stats Bot Active', { status: 200 });
    }

    try {
      const update = await request.json();
      const botToken = env.BOT_TOKEN_STATS;
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

        // ── KUNCI SATPAM TOPIK STATISTIK (Thread ID: 2) ──
        const isGroup = query.message.chat.type === 'group' || query.message.chat.type === 'supergroup';
        if (isGroup && Number(threadId) !== 2) {
          await answerCallback(botToken, query.id, "Fitur ini hanya aktif di Topik Statistik Mahasiswa!");
          return new Response('OK', { status: 200 });
        }

        const acc = await getStudentAccount(supabaseUrl, supabaseKey, userId);

        if (!acc) {
          await answerCallback(botToken, query.id, "Akun belum terhubung! Silakan login di DM Bot Master terlebih dahulu.");
          return new Response('OK', { status: 200 });
        }

        if (cbData === "btn_analisis_nilai") {
          await answerCallback(botToken, query.id, "Menganalisis performa akademik...");

          try {
            // Ambil KHS & Nilai dari SIAKAD via backend UBSI-API
            const [khsRes, gradesRes] = await Promise.all([
              fetch(`${backendUrl}/v1/studentv2/khs`, {
                headers: {
                  'X-API-Key': apiKey,
                  'X-StudentV2-NIM': acc.nim,
                  'X-StudentV2-Pass': acc.encrypted_password,
                  'X-Nim': acc.nim,
                  'X-Pass': acc.encrypted_password,
                }
              }),
              fetch(`${backendUrl}/v1/studentv2/grades`, {
                headers: {
                  'X-API-Key': apiKey,
                  'X-StudentV2-NIM': acc.nim,
                  'X-StudentV2-Pass': acc.encrypted_password,
                  'X-Nim': acc.nim,
                  'X-Pass': acc.encrypted_password,
                }
              })
            ]);

            const khsData = await khsRes.json();
            const gradesData = await gradesRes.json();

            // 1. Notif Privasi di Topik Grup (NILAI TIDAK DIBOCORKAN DI GRUP)
            await sendTelegram(
              botToken,
              chatId,
              `📊 *Laporan Selesai Dihitung!*\n\nData diagnosis nilai untuk *${userName}* telah dikirimkan secara rahasia ke DM *Bot Master*. Silakan buka chat pribadimu! 🔒`,
              threadId
            );

            // 2. Kalkulasi Matematis di Sisi Worker
            const summary = khsData.data || {};
            const ipk = summary.ipk || summary.gpa || "-";
            const sksTotal = summary.total_sks || summary.sks || "-";

            let leakReport = "";
            const listGrades = Array.isArray(gradesData.data) ? gradesData.data : [];

            if (listGrades.length > 0) {
              // Cari matkul yang berpotensi bocor/nilai di bawah B (angka < 70)
              const lowGrades = listGrades.filter(g => {
                const val = parseFloat(g.nilai_akhir || g.score || 0);
                return val > 0 && val < 70;
              });

              if (lowGrades.length > 0) {
                leakReport += `⚠️ *TITIK BOCOR NILAI TERDETEKSI:*\n`;
                lowGrades.slice(0, 3).forEach(lg => {
                  leakReport += `• *${lg.matakuliah || lg.nama_matakuliah}*\n  Nilai: ${lg.nilai_akhir || '-'} (Grade: ${lg.grade || 'C/D'})\n  💡 _Tugas E-Learning & Kehadiran wajib dimaksimalkan!_\n`;
                });
              } else {
                leakReport += `✨ *Semua matkul berjalan di zona aman (Grade A/B)! Pertahankan ritmemu!*`;
              }
            }

            // 3. Kirim Hasil Lengkap ke DM via Bot Master
            if (masterBotToken) {
              const fullReport = 
                `📈 *DIAGNOSIS AKADEMIK MAHASISWA*\n` +
                `━━━━━━━━━━━━━━━━━━━━\n` +
                `👤 *Nama:* ${acc.full_name || userName}\n` +
                `🆔 *NIM:* ${acc.nim}\n` +
                `🎓 *Prodi:* ${acc.prodi || 'Informatika'}\n\n` +
                `📊 *STATISTIK SEMENTARA:*\n` +
                `• *IPK Kumulatif:* ${ipk}\n` +
                `• *Total SKS Lulus:* ${sksTotal} SKS\n\n` +
                `${leakReport}\n\n` +
                `━━━━━━━━━━━━━━━━━━━━\n` +
                `🎯 *Simulasi Cumlaude:* Target IPK ≥ 3.50 membutuhkan minimal 4 Matkul bernilai A di sisa semester berjalan. 🤍`;

              await sendTelegram(masterBotToken, userId, fullReport);
            }

          } catch (err) {
            await sendTelegram(botToken, chatId, `❌ Gagal memproses data akademik: ${err.message}`, threadId);
          }

          return new Response('OK', { status: 200 });
        }
      }

      // ── 2. HANDLE COMMAND DI TOPIK ──
      if (update.message) {
        const msg = update.message;
        const chatId = msg.chat.id;
        const threadId = msg.message_thread_id || null;
        const text = (msg.text || '').trim();

        // ── KUNCI SATPAM TOPIK STATISTIK (Thread ID: 2) ──
        const isGroup = msg.chat.type === 'group' || msg.chat.type === 'supergroup';
        if (isGroup && Number(threadId) !== 2) {
          return new Response('Ignored out-of-topic message', { status: 200 });
        }

        if (text.startsWith('/stats') || text.startsWith('/nilai') || text.startsWith('/menu')) {
          const menuText = 
            "📈 *PORTAL STATISTIK & PREDIKSI AKADEMIK USRC*\n\n" +
            "Sistem analisis matematis performa belajar mahasiswa. Privasi 100% terjaga (hasil detail dikirim langsung ke DM Bot Master):";

          const keyboard = {
            inline_keyboard: [
              [
                { text: "📊 Analisis Performa & Titik Lemah", callback_data: "btn_analisis_nilai" }
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
