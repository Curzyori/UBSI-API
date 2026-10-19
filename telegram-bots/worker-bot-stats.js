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

            const khs = khsData.data || {};
            const listGrades = Array.isArray(gradesData.data) ? gradesData.data : [];
            const ipk = typeof khs.ipk === 'number' ? khs.ipk : parseFloat(khs.ipk) || null;
            const totalSks = khs.total_sks || 0;

            // IPS semester berjalan (rata-rata tertimbang SKS dari nilai murni)
            let sumWeighted = 0, sumSksNow = 0;
            listGrades.forEach(g => {
              const t = parseFloat(g.total);
              const s = parseInt(g.sks) || 0;
              if (!isNaN(t) && s > 0) { sumWeighted += t * s; sumSksNow += s; }
            });
            const ipsNow = sumSksNow > 0 ? (sumWeighted / sumSksNow) : null;

            // Diagnosis komponen terlemah (bobot BSI: UAS 30, UTS 25, Tugas 25, Absen 20)
            const komponen = [["UAS", 30, "uas"], ["UTS", 25, "uts"], ["Tugas", 25, "tugas"], ["Absen", 20, "absen"]];
            const matkulDiag = [];
            listGrades.forEach(g => {
              const total = parseFloat(g.total);
              if (isNaN(total) || total >= 75) return;
              let worst = null;
              komponen.forEach(k => {
                const v = g[k[2]];
                if (v === null || v === undefined) return;
                const loss = k[1] * (100 - v) / 100;
                if (!worst || loss > worst.loss) worst = { label: k[0], v: v, loss: loss };
              });
              if (worst) matkulDiag.push({ nama: g.nama || g.kode || "Mata Kuliah", total: total, grade: g.grade, worst: worst });
            });
            matkulDiag.sort((a, b) => a.total - b.total);

            let diagText = "";
            if (matkulDiag.length > 0) {
              diagText = "⚠️ *MATKUL YANG PERLU DONGKRAK:*\n";
              matkulDiag.slice(0, 5).forEach(m => {
                diagText += `• *${m.nama}* — nilai ${m.total} (Grade: ${m.grade || "-"})\n`;
                diagText += `  Titik bocor: *${m.worst.label}* (${m.worst.v}) — kontribusi terbesar penurunan nilai.\n`;
              });
            } else {
              diagText = "✨ *Semua matkul berjalan di zona aman (nilai >= 75)! Pertahankan ritmemu!*\n";
            }

            // Simulator target IPK 3.50 (murni matematis, batas IPS = 4.00)
            let simText = "";
            if (ipk !== null && totalSks > 0) {
              simText = "\n🎯 *SIMULASI CAPAI CUMAUDE (IPK >= 3.50):*\n";
              [18, 21, 24].forEach(sNext => {
                const need = (3.50 * (totalSks + sNext) - ipk * totalSks) / sNext;
                if (need <= 4.0) {
                  simText += `• Ambil ${sNext} SKS: butuh IPS >= *${need.toFixed(2)}* — FEASIBLE\n`;
                } else {
                  simText += `• Ambil ${sNext} SKS: butuh IPS >= ${need.toFixed(2)} — tidak mungkin dalam 1 semester\n`;
                }
              });
              simText += "\n💡 Semakin banyak SKS ditempuh dengan grade A, semakin cepat IPK naik.";
            }

            // 1. Notif privasi di topik (NILAI TIDAK DIBOCORKAN DI GRUP)
            await sendTelegram(
              botToken,
              chatId,
              `📊 *Analisis selesai, ${userName}!* Hasil lengkap dikirim ke DM Bot Master. 🔒`,
              threadId
            );

            // 2. Laporan lengkap ke DM via Bot Master
            if (!masterBotToken) return new Response('OK', { status: 200 });

            const fullReport =
              `📈 *DIAGNOSIS AKADEMIK LENGKAP*\n` +
              `━━━━━━━━━━━━━━━━━━━━\n` +
              `👤 *Nama:* ${acc.full_name || userName}\n` +
              `🆔 *NIM:* ${acc.nim}\n` +
              `🎓 *Prodi:* ${acc.prodi || "-"}\n\n` +
              `📊 *STATISTIK:*\n` +
              `• *IPK Kumulatif:* ${ipk !== null ? ipk : "-"}\n` +
              `• *Total SKS Lulus:* ${totalSks || "-"}\n` +
              (ipsNow !== null ? `• *IPS Semester Berjalan:* ${ipsNow.toFixed(2)}\n` : "") +
              `\n${diagText}` +
              (simText ? `\n${simText}` : "") +
              `\n🤍 Data diambil langsung dari SIAKAD & MyBest kampus.`;

            const dmResult = await sendTelegram(masterBotToken, userId, fullReport);

            // 3. Kalau DM gagal (user belum /start Bot Master), kabari di topik
            if (!dmResult.ok) {
              await sendTelegram(
                botToken,
                chatId,
                `⚠️ *${userName}*, gagal mengirim laporan ke DM. Buka chat *Bot Master* dan tekan /start dulu, lalu klik tombol analisis lagi!`,
                threadId
              );
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

  const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  let j = await resp.json().catch(() => ({ ok: false }));

  // Fallback: kalau Markdown ditolak (karakter aneh dari nama matkul/dosen), kirim polos
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

async function answerCallback(token, queryId, text) {
  await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: queryId, text: text })
  });
}
