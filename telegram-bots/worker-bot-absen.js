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
            // Endpoint resmi backend: POST /v1/elearning/presence (token opsional via query)
            const presRes = await safeFetchJson(`${backendUrl}/v1/elearning/presence`, {
              method: 'POST',
              headers: {
                'X-API-Key': apiKey,
                'X-Elearning-NIM': acc.nim,
                'X-Elearning-Pass': acc.encrypted_password,
                'X-Nim': acc.nim,
                'X-Pass': acc.encrypted_password,
              }
            });

            if (!presRes.ok && (!presRes.data || !presRes.data.success)) {
              const errMsg = presRes.data?.error?.message || (presRes.status === 502 ? "Server backend/kampus sedang sibuk (502). Coba sesaat lagi." : `Gagal menghubungi server (${presRes.status})`);
              await sendTelegram(botToken, chatId, `⚠️ *Gagal Absen (${userName}):*\n${errMsg}`, threadId);
              return new Response('OK', { status: 200 });
            }

            const presData = presRes.data || {};

            // PENTING: backend membungkus hasil di dalam "data".
            // Outer success selalu true (HTTP 200) walau sesi tidak aktif,
            // jadi status sukses/gagal yang ASLI ada di presData.data.success
            const r = presData.data || {};

            if (presData.success && r.success) {
              const mkName = r.matakuliah || "Kuliah Hari Ini";
              const dosen = r.dosen || "-";
              const jamAbsen = new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Pontianak' });

              // Resi anti-rekayasa (kegagalan tabel tidak memutus alur)
              const resiCode = await saveReceipt(supabaseUrl, supabaseKey, {
                code: genCode("ABS"), type: "absen",
                user_id: userId, nim: acc.nim,
                full_name: acc.full_name || userName,
                summary: `Presensi "${mkName}" (${dosen}) pukul ${jamAbsen} WIB`,
                ref_id: null,
              });

              // 1. Notif Ringkas di Topik Grup (bukti yang nempel)
              await sendTelegram(
                botToken,
                chatId,
                `✅ *Presensi Berhasil!*\n\n• Mahasiswa: *${userName}*\n• Matkul: *${mkName}*\n• Status: *Hadir di MyBest* ⚡` +
                (resiCode ? `\n🧾 Resi: \`${resiCode}\`` : ""),
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
                  `• Waktu Absen: *${jamAbsen} WIB*\n` +
                  (resiCode ? `• Resi: \`${resiCode}\` _(verifikasi: /cek ${resiCode})_\n` : "") +
                  `\nStatus kehadiranmu sudah tercatat resmi di portal MyBest kampus! 🤍`
                );
              }

              await ghostLog(supabaseUrl, supabaseKey, botToken, {
                bot: "absen", chat_id: chatId, thread_id: threadId,
                user_id: userId, user_name: acc.full_name || userName, nim: acc.nim,
                command: "btn_absen_now",
                detail: `presensi "${mkName}" (${dosen}) — resi ${resiCode || "-"}`,
                outcome: "success"
              });
            } else {
              const msgErr = r.message || r.status || presData.error?.message || "Tidak ada sesi kuliah yang sedang membuka presensi saat ini.";
              await sendTelegram(
                botToken,
                chatId,
                `⚠️ *Gagal Absen (${userName}):*\n${msgErr}`,
                threadId
              );
              await ghostLog(supabaseUrl, supabaseKey, botToken, {
                bot: "absen", chat_id: chatId, thread_id: threadId,
                user_id: userId, user_name: userName, nim: acc.nim,
                command: "btn_absen_now", detail: String(msgErr), outcome: "failed"
              });
            }
          } catch (err) {
            await sendTelegram(botToken, chatId, `❌ Terjadi kesalahan sistem: ${err.message}`, threadId);
            await ghostLog(supabaseUrl, supabaseKey, botToken, {
              bot: "absen", chat_id: chatId, thread_id: threadId,
              user_id: userId, user_name: userName, nim: acc ? acc.nim : null,
              command: "btn_absen_now", detail: `error sistem: ${err.message}`, outcome: "failed"
            });
          }

          return new Response('OK', { status: 200 });
        }

        if (cbData === "btn_jadwal_today" || cbData === "re_jadwal") {
          const isRefresh = cbData === "re_jadwal";
          await answerCallback(botToken, query.id, isRefresh ? "Memperbarui jadwal..." : "Mengambil jadwal kuliah...");

          try {
            const siakadPass = acc.siakad_password || acc.encrypted_password;
            const schRes = await safeFetchJson(`${backendUrl}/v1/studentv2/schedule`, {
              headers: {
                'X-API-Key': apiKey,
                'X-StudentV2-NIM': acc.nim,
                'X-StudentV2-Pass': siakadPass,
                'X-Nim': acc.nim,
                'X-Pass': siakadPass,
              }
            });

            if (!schRes.ok && (!schRes.data || !schRes.data.success)) {
              const errMsg = schRes.data?.error?.message || (schRes.status === 502 ? "Portal SIAKAD kampus sedang lambat/down (502). Coba sesaat lagi." : `Gagal mengambil jadwal (${schRes.status})`);
              await sendTelegram(botToken, chatId, `⚠️ *Gagal Jadwal (${userName}):*\n${errMsg}`, threadId);
              await ghostLog(supabaseUrl, supabaseKey, botToken, {
                bot: "absen", chat_id: chatId, thread_id: threadId,
                user_id: userId, user_name: userName, nim: acc.nim,
                command: cbData, detail: String(errMsg), outcome: "failed"
              });
              return new Response('OK', { status: 200 });
            }

            const schData = schRes.data || {};

            if (!schData.success || !schData.data || schData.data.length === 0) {
              await sendTelegram(botToken, chatId, `📋 Tidak ada jadwal kuliah terdaftar untuk NIM *${acc.nim}*.`, threadId);
              return new Response('OK', { status: 200 });
            }

            const items = schData.data.map(j => ({
              nama: j.nama || j.matakuliah || j.nama_mata_kuliah || "Mata Kuliah",
              sks: j.sks || null,
              hari: j.hari || "-",
              jam: j.jam || j.waktu || "-",
              ruang: j.ruang || "-"
            }));

            const textSch = renderJadwalText(items, EPHEMERAL_MINUTES);
            const jadwalKb = { inline_keyboard: [[{ text: "🔄 Perbarui", callback_data: "re_jadwal" }]] };

            if (isRefresh) {
              // Edit-in-place + reset kedaluwarsa list hidup
              const ed = await tgApi(botToken, "editMessageText", {
                chat_id: chatId, message_id: query.message.message_id,
                text: textSch, parse_mode: "Markdown", reply_markup: jadwalKb
              });
              if (ed.ok) {
                await patchEphemeralJadwal(supabaseUrl, supabaseKey, chatId, query.message.message_id, items);
              } else {
                const sent = await sendTelegram(botToken, chatId, textSch, threadId, jadwalKb);
                await registerEphemeral(supabaseUrl, supabaseKey, {
                  bot: "absen", chat_id: chatId, message_id: sent?.result?.message_id || 0,
                  thread_id: threadId, user_id: userId, user_name: userName,
                  kind: "jadwal", payload: { items },
                  expires_at: new Date(Date.now() + EPHEMERAL_MINUTES * 60000).toISOString()
                });
              }
              await ghostLog(supabaseUrl, supabaseKey, botToken, {
                bot: "absen", chat_id: chatId, thread_id: threadId,
                user_id: userId, user_name: userName, nim: acc.nim,
                command: "re_jadwal", detail: `${items.length} jadwal diperbarui (list hidup)`, outcome: "success"
              });
              return new Response('OK', { status: 200 });
            }

            const sent = await sendTelegram(botToken, chatId, textSch, threadId, jadwalKb);

            // Daftarkan sebagai list hidup: tick tiap menit, menguap otomatis
            await registerEphemeral(supabaseUrl, supabaseKey, {
              bot: "absen", chat_id: chatId, message_id: sent?.result?.message_id || 0,
              thread_id: threadId, user_id: userId, user_name: userName,
              kind: "jadwal", payload: { items },
              expires_at: new Date(Date.now() + EPHEMERAL_MINUTES * 60000).toISOString()
            });

            await ghostLog(supabaseUrl, supabaseKey, botToken, {
              bot: "absen", chat_id: chatId, thread_id: threadId,
              user_id: userId, user_name: userName, nim: acc.nim,
              command: "btn_jadwal_today", detail: `${items.length} jadwal → list hidup ${EPHEMERAL_MINUTES} menit`, outcome: "success"
            });
          } catch (err) {
            await sendTelegram(botToken, chatId, `❌ Gagal mengambil jadwal: ${err.message}`, threadId);
            await ghostLog(supabaseUrl, supabaseKey, botToken, {
              bot: "absen", chat_id: chatId, thread_id: threadId,
              user_id: userId, user_name: userName, nim: acc ? acc.nim : null,
              command: cbData, detail: `error sistem: ${err.message}`, outcome: "failed"
            });
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
  },

  // ── CRON TIAP MENIT: tick list jadwal hidup + sweep yang kedaluwarsa ──
  async scheduled(event, env, ctx) {
    const botToken = env.BOT_TOKEN_ABSEN;
    const supabaseUrl = env.SUPABASE_URL || 'https://wagvbmkimpswiidnenwx.supabase.co';
    const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;
    if (!botToken || !supabaseKey) return;

    try {
      const res = await fetch(`${supabaseUrl}/rest/v1/ubsi_ephemeral_msgs?bot=eq.absen&select=*`, {
        headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
      });
      const rows = await res.json().catch(() => []);
      if (!Array.isArray(rows) || rows.length === 0) return;

      const now = Date.now();
      for (const row of rows) {
        const expired = row.expires_at && new Date(row.expires_at).getTime() <= now;

        if (expired) {
          if (row.message_id) await deleteMessage(botToken, row.chat_id, row.message_id);
          await fetch(`${supabaseUrl}/rest/v1/ubsi_ephemeral_msgs?id=eq.${row.id}`, {
            method: 'DELETE',
            headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
          }).catch(() => {});
          await ghostLog(supabaseUrl, supabaseKey, botToken, {
            bot: "absen", chat_id: row.chat_id, thread_id: row.thread_id,
            user_id: row.user_id, user_name: row.user_name, nim: null,
            command: `${row.kind}_kedaluwarsa`, detail: "list hidup menguap dari grup", outcome: "expired"
          });
          continue;
        }

        // Masih hidup & jadwal: tick hitung mundur tiap menit (edit-in-place)
        if (row.kind === 'jadwal' && row.payload && Array.isArray(row.payload.items)) {
          const sisaMenit = Math.max(0, Math.round((new Date(row.expires_at).getTime() - now) / 60000));
          const ed = await tgApi(botToken, "editMessageText", {
            chat_id: row.chat_id, message_id: row.message_id,
            text: renderJadwalText(row.payload.items, sisaMenit),
            parse_mode: "Markdown",
            reply_markup: { inline_keyboard: [[{ text: "🔄 Perbarui", callback_data: "re_jadwal" }]] }
          });
          if (!ed.ok) {
            // "message is not modified" = teks sama, biarkan; selain itu pesan sudah hilang → drop row
            if (!/not modified/i.test(ed.description || "")) {
              await fetch(`${supabaseUrl}/rest/v1/ubsi_ephemeral_msgs?id=eq.${row.id}`, {
                method: 'DELETE',
                headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
              }).catch(() => {});
            }
          }
        }
      }
    } catch (_) {}
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
  let j = await resp.json().catch(() => ({}));

  // Fallback: kalau Markdown gagal karena karakter aneh (nama matkul/dosen
  // mengandung _ atau *), kirim ulang sebagai teks polos
  if (!j.ok && payload.parse_mode) {
    delete payload.parse_mode;
    const r2 = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    j = await r2.json().catch(() => ({}));
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

// ── CLEAN GROUP EXPERIENCE: helpers ──
const EPHEMERAL_MINUTES = 20;

async function tgApi(token, method, body) {
  try {
    const resp = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return await resp.json().catch(() => ({ ok: false }));
  } catch (_) {
    return { ok: false };
  }
}

async function deleteMessage(token, chatId, messageId) {
  await fetch(`https://api.telegram.org/bot${token}/deleteMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId })
  }).catch(() => {});
}

// Ghost Log: yang menguap dari grup tetap tercatat (tabel; /ingat di Bot Master)
async function ghostLog(supabaseUrl, supabaseKey, botToken, entry) {
  try {
    await fetch(`${supabaseUrl}/rest/v1/ubsi_ghost_log`, {
      method: 'POST',
      headers: {
        'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(entry)
    });
  } catch (_) {}
}

// Kode resi unik (set aman: tanpa I, L, O, 0, 1)
function genCode(prefix) {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const buf = new Uint8Array(4);
  crypto.getRandomValues(buf);
  let s = "";
  for (const b of buf) s += chars[b % chars.length];
  return `${prefix}-${s}`;
}

// Simpan resi; kegagalan tabel tidak boleh memutus alur utama
async function saveReceipt(supabaseUrl, supabaseKey, r) {
  if (!r || !r.code) return null;
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/ubsi_receipts`, {
      method: 'POST',
      headers: {
        'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=ignore-duplicates,return=representation'
      },
      body: JSON.stringify(r)
    });
    if (res.ok) return r.code;
  } catch (_) {}
  return null;
}

async function registerEphemeral(supabaseUrl, supabaseKey, row) {
  try {
    await fetch(`${supabaseUrl}/rest/v1/ubsi_ephemeral_msgs`, {
      method: 'POST',
      headers: {
        'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(row)
    });
  } catch (_) {}
}

async function patchEphemeralJadwal(supabaseUrl, supabaseKey, chatId, messageId, items) {
  try {
    await fetch(
      `${supabaseUrl}/rest/v1/ubsi_ephemeral_msgs?bot=eq.absen&kind=eq.jadwal&chat_id=eq.${chatId}&message_id=eq.${messageId}`,
      {
        method: 'PATCH',
        headers: {
          'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          payload: { items },
          expires_at: new Date(Date.now() + EPHEMERAL_MINUTES * 60000).toISOString()
        })
      }
    );
  } catch (_) {}
}

// Render list jadwal hidup + hitung mundur live per matkul (zona WIB)
function renderJadwalText(items, sisaMenit) {
  const HARI_IDX = { "minggu": 0, "senin": 1, "selasa": 2, "rabu": 3, "kamis": 4, "jumat": 5, "jum'at": 5, "sabtu": 6 };
  // "Sekarang" versi WIB
  const nowWib = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Pontianak' }));
  const todayIdx = nowWib.getDay();

  let text = `📋 *JADWAL KULIAH (LIST HIDUP):*\n\n`;
  items.forEach((j, idx) => {
    const sks = j.sks ? ` (${j.sks} SKS)` : "";
    text += `${idx + 1}. *${j.nama}*${sks}\n`;
    text += `   ⏰ ${j.hari || '-'}, ${j.jam || '-'} (Ruang: ${j.ruang || '-'})\n`;

    // Coba parse hari + jam "HH:MM-HH:MM" untuk hitung mundur live
    const dayIdx = HARI_IDX[String(j.hari || '').trim().toLowerCase()];
    const m = String(j.jam || '').match(/(\d{1,2})[:.](\d{2})\s*[-–]\s*(\d{1,2})[:.](\d{2})/);
    if (dayIdx !== undefined && m) {
      const startM = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
      const endM = parseInt(m[3], 10) * 60 + parseInt(m[4], 10);
      const nowM = nowWib.getHours() * 60 + nowWib.getMinutes();
      let dayDiff = (dayIdx - todayIdx + 7) % 7;
      if (dayDiff === 0 && nowM >= endM) dayDiff = 7; // sudah lewat minggu ini

      if (dayDiff === 0 && nowM >= startM && nowM < endM) {
        const left = endM - nowM;
        text += `   🔥 *BERLANGSUNG* — selesai dalam ${Math.floor(left / 60)}j ${left % 60}m\n`;
      } else {
        const target = new Date(nowWib);
        target.setDate(target.getDate() + dayDiff);
        target.setHours(Math.floor(startM / 60), startM % 60, 0, 0);
        const diffMin = Math.round((target - nowWib) / 60000);
        const d = Math.floor(diffMin / 1440);
        const h = Math.floor((diffMin % 1440) / 60);
        const mm = diffMin % 60;
        text += `   ⏳ mulai ${d > 0 ? `${d}h ` : ""}${h}j ${mm}m lagi\n`;
      }
    }
    text += `\n`;
  });

  text += `⏱ *List hidup* — menguap otomatis dalam ${sisaMenit} menit.\n`;
  text += `_Tekan 🔄 Perbarui untuk muat jadwal terbaru._`;
  return text;
}
