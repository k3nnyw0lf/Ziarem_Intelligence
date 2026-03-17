import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import fetch from 'node-fetch';
import QRCode from 'qrcode';
import pino from 'pino';
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
  makeInMemoryStore,
  proto,
  getContentType,
} from '@whiskeysockets/baileys';

// ─── Configuration ───────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3100;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
const TELEGRAM_WEBHOOK = 'https://n8n.srv1257040.hstgr.cloud/webhook/telegram-send';

const logger = pino({ level: 'warn' });

// ─── Supabase helper ─────────────────────────────────────────────────────────

async function supabase(path, { method = 'GET', body, params } = {}) {
  let url = `${SUPABASE_URL}/rest/v1/${path}`;
  if (params) {
    const qs = new URLSearchParams(params).toString();
    url += `?${qs}`;
  }
  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: method === 'POST' ? 'return=representation' : method === 'PATCH' ? 'return=representation' : undefined,
  };
  // Remove undefined headers
  Object.keys(headers).forEach((k) => headers[k] === undefined && delete headers[k]);

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  if (!res.ok) {
    console.error(`Supabase ${method} ${path} failed: ${res.status}`, text);
    throw new Error(`Supabase error ${res.status}: ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

// ─── In-memory session store ─────────────────────────────────────────────────

const sessions = new Map(); // sessionId -> { socket, store, saveCreds, status, phone, name, retryCount }
const msgRetryCounts = new Map(); // global retry counter cache

// ─── Express + HTTP + WebSocket setup ────────────────────────────────────────

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const wsClients = new Set();

wss.on('connection', (ws) => {
  wsClients.add(ws);
  console.log(`[WS] Client connected (${wsClients.size} total)`);

  ws.on('close', () => {
    wsClients.delete(ws);
    console.log(`[WS] Client disconnected (${wsClients.size} total)`);
  });

  ws.on('error', (err) => {
    console.error('[WS] Client error:', err.message);
    wsClients.delete(ws);
  });

  // Send current session statuses on connect
  const statuses = [];
  for (const [id, s] of sessions) {
    statuses.push({ sessionId: id, status: s.status, phone: s.phone, name: s.name });
  }
  ws.send(JSON.stringify({ event: 'init', data: { sessions: statuses } }));
});

function broadcast(event, data) {
  const payload = JSON.stringify({ event, data });
  for (const ws of wsClients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  }
}

// ─── Custom Supabase auth state ──────────────────────────────────────────────

function makeSupabaseAuthState(sessionId) {
  let creds = null;
  let keys = {};

  async function loadFromDB() {
    try {
      const rows = await supabase('vault_wa_sessions', {
        params: { id: `eq.${sessionId}`, select: 'auth_creds' },
      });
      if (rows && rows.length > 0 && rows[0].auth_creds) {
        const stored = typeof rows[0].auth_creds === 'string'
          ? JSON.parse(rows[0].auth_creds)
          : rows[0].auth_creds;
        creds = stored.creds || null;
        keys = stored.keys || {};
      }
    } catch (err) {
      console.error(`[Auth] Failed to load creds for ${sessionId}:`, err.message);
    }
  }

  async function saveToDB() {
    try {
      await supabase('vault_wa_sessions', {
        method: 'PATCH',
        params: { id: `eq.${sessionId}` },
        body: {
          auth_creds: JSON.stringify({ creds, keys }),
          updated_at: new Date().toISOString(),
        },
      });
    } catch (err) {
      console.error(`[Auth] Failed to save creds for ${sessionId}:`, err.message);
    }
  }

  const state = {
    loadFromDB,
    saveCreds: async () => {
      await saveToDB();
    },
    state: {
      get creds() {
        return creds;
      },
      set creds(val) {
        creds = val;
      },
      keys: {
        get: (type, ids) => {
          const data = {};
          for (const id of ids) {
            const k = `${type}-${id}`;
            if (keys[k]) data[id] = keys[k];
          }
          return data;
        },
        set: (data) => {
          for (const type in data) {
            for (const id in data[type]) {
              keys[`${type}-${id}`] = data[type][id];
            }
          }
          saveToDB().catch(() => {});
        },
      },
    },
  };

  return state;
}

// ─── Phone number matching ───────────────────────────────────────────────────

async function matchContactByPhone(phone) {
  if (!phone) return null;
  // Clean phone number
  const cleaned = phone.replace(/[^0-9]/g, '');
  if (!cleaned) return null;

  try {
    // Try exact match first
    let rows = await supabase('contacts', {
      params: { phone: `eq.${cleaned}`, select: 'id,name,phone', limit: '1' },
    });
    if (rows && rows.length > 0) return rows[0];

    // Try with "+" prefix
    rows = await supabase('contacts', {
      params: { phone: `eq.+${cleaned}`, select: 'id,name,phone', limit: '1' },
    });
    if (rows && rows.length > 0) return rows[0];

    // Try matching last 10 digits using ilike
    if (cleaned.length >= 10) {
      const last10 = cleaned.slice(-10);
      rows = await supabase('contacts', {
        params: { phone: `like.%${last10}`, select: 'id,name,phone', limit: '1' },
      });
      if (rows && rows.length > 0) return rows[0];
    }
  } catch (err) {
    console.error('[Match] Contact match error:', err.message);
  }
  return null;
}

// ─── Telegram notification ───────────────────────────────────────────────────

async function notifyTelegram(text) {
  try {
    await fetch(TELEGRAM_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text }),
    });
  } catch (err) {
    console.error('[Telegram] Notification failed:', err.message);
  }
}

// ─── Extract phone from JID ─────────────────────────────────────────────────

function phoneFromJid(jid) {
  if (!jid) return null;
  return jid.replace(/@s\.whatsapp\.net$/, '').replace(/@g\.us$/, '');
}

// ─── Parse message content ──────────────────────────────────────────────────

function extractMessageContent(msg) {
  if (!msg?.message) return { type: 'unknown', body: '' };

  const m = msg.message;
  const contentType = getContentType(m);

  switch (contentType) {
    case 'conversation':
      return { type: 'text', body: m.conversation };
    case 'extendedTextMessage':
      return { type: 'text', body: m.extendedTextMessage?.text || '' };
    case 'imageMessage':
      return { type: 'image', body: m.imageMessage?.caption || '', mimetype: m.imageMessage?.mimetype, url: m.imageMessage?.url };
    case 'videoMessage':
      return { type: 'video', body: m.videoMessage?.caption || '', mimetype: m.videoMessage?.mimetype };
    case 'audioMessage':
      return { type: 'audio', body: '', mimetype: m.audioMessage?.mimetype, seconds: m.audioMessage?.seconds };
    case 'documentMessage':
      return { type: 'document', body: m.documentMessage?.fileName || '', mimetype: m.documentMessage?.mimetype };
    case 'stickerMessage':
      return { type: 'sticker', body: '' };
    case 'contactMessage':
      return { type: 'contact', body: m.contactMessage?.displayName || '' };
    case 'locationMessage':
      return { type: 'location', body: `${m.locationMessage?.degreesLatitude},${m.locationMessage?.degreesLongitude}` };
    case 'reactionMessage':
      return { type: 'reaction', body: m.reactionMessage?.text || '' };
    default:
      return { type: contentType || 'unknown', body: '' };
  }
}

// ─── Update DB session status ────────────────────────────────────────────────

async function updateSessionStatus(sessionId, status, extra = {}) {
  try {
    await supabase('vault_wa_sessions', {
      method: 'PATCH',
      params: { id: `eq.${sessionId}` },
      body: { status, ...extra, updated_at: new Date().toISOString() },
    });
  } catch (err) {
    console.error(`[DB] Failed to update session status for ${sessionId}:`, err.message);
  }
}

// ─── Start a Baileys session ─────────────────────────────────────────────────

async function startSession(sessionId) {
  if (sessions.has(sessionId)) {
    const existing = sessions.get(sessionId);
    if (existing.status === 'connected' || existing.status === 'connecting') {
      console.log(`[Session] ${sessionId} already ${existing.status}`);
      return existing;
    }
  }

  console.log(`[Session] Starting ${sessionId}...`);

  const authState = makeSupabaseAuthState(sessionId);
  await authState.loadFromDB();

  const { version } = await fetchLatestBaileysVersion();
  console.log(`[Baileys] Using version ${version.join('.')}`);

  const store = makeInMemoryStore({ logger });

  const socket = makeWASocket({
    version,
    logger,
    auth: authState.state,
    printQRInTerminal: false,
    browser: ['VAULT CRM', 'Chrome', '120.0'],
    msgRetryCounterCache: msgRetryCounts,
    generateHighQualityLinkPreview: false,
    syncFullHistory: false,
    markOnlineOnConnect: false,
  });

  store.bind(socket.ev);

  const session = {
    socket,
    store,
    saveCreds: authState.saveCreds,
    status: 'connecting',
    phone: null,
    name: null,
    retryCount: 0,
  };

  sessions.set(sessionId, session);
  await updateSessionStatus(sessionId, 'connecting');

  // ─── Connection update handler ───────────────────────────────────────

  socket.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    // QR code received
    if (qr) {
      console.log(`[Session] ${sessionId} — QR code generated`);
      try {
        const qrBase64 = await QRCode.toDataURL(qr, { width: 300, margin: 2 });
        session.status = 'qr';
        broadcast('qr', { sessionId, qr: qrBase64 });
      } catch (err) {
        console.error(`[QR] Error generating QR for ${sessionId}:`, err.message);
      }
    }

    // Connection opened
    if (connection === 'open') {
      console.log(`[Session] ${sessionId} — Connected!`);
      session.status = 'connected';
      session.retryCount = 0;

      // Get session phone/name from creds
      const me = socket.user;
      if (me) {
        session.phone = phoneFromJid(me.id);
        session.name = me.name || me.verifiedName || session.phone;
      }

      await updateSessionStatus(sessionId, 'connected', {
        phone: session.phone,
        name: session.name,
      });

      broadcast('connected', {
        sessionId,
        phone: session.phone,
        name: session.name,
      });

      // Save credentials
      await authState.saveCreds();
    }

    // Connection closed
    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const reason = DisconnectReason[statusCode] || statusCode || 'unknown';
      const loggedOut = statusCode === DisconnectReason.loggedOut;

      console.log(`[Session] ${sessionId} — Disconnected: ${reason} (code ${statusCode})`);

      session.status = 'disconnected';
      broadcast('disconnected', { sessionId, reason: String(reason) });

      if (loggedOut) {
        // User logged out — clear auth and mark as logged_out
        console.log(`[Session] ${sessionId} — Logged out, clearing auth`);
        await updateSessionStatus(sessionId, 'logged_out', { auth_creds: null });
        sessions.delete(sessionId);
      } else {
        // Reconnect with backoff
        session.retryCount = (session.retryCount || 0) + 1;
        const maxRetries = 10;

        if (session.retryCount <= maxRetries) {
          const delay = Math.min(session.retryCount * 2000, 30000);
          console.log(`[Session] ${sessionId} — Reconnecting in ${delay}ms (attempt ${session.retryCount}/${maxRetries})`);
          await updateSessionStatus(sessionId, 'reconnecting');

          setTimeout(() => {
            if (sessions.has(sessionId)) {
              startSession(sessionId).catch((err) => {
                console.error(`[Session] ${sessionId} — Reconnect failed:`, err.message);
              });
            }
          }, delay);
        } else {
          console.log(`[Session] ${sessionId} — Max retries reached, giving up`);
          await updateSessionStatus(sessionId, 'disconnected');
          sessions.delete(sessionId);
        }
      }
    }
  });

  // ─── Credentials update handler ──────────────────────────────────────

  socket.ev.on('creds.update', async () => {
    await authState.saveCreds();
  });

  // ─── Messages handler ───────────────────────────────────────────────

  socket.ev.on('messages.upsert', async ({ messages: msgs, type }) => {
    for (const msg of msgs) {
      if (!msg.message) continue; // skip protocol messages
      if (msg.key.remoteJid === 'status@broadcast') continue; // skip status updates

      const fromMe = msg.key.fromMe || false;
      const jid = msg.key.remoteJid;
      const phone = phoneFromJid(jid);
      const content = extractMessageContent(msg);
      const pushName = msg.pushName || '';
      const timestamp = msg.messageTimestamp
        ? typeof msg.messageTimestamp === 'number'
          ? msg.messageTimestamp
          : msg.messageTimestamp.low || Math.floor(Date.now() / 1000)
        : Math.floor(Date.now() / 1000);

      // Match to VAULT contact
      const contact = await matchContactByPhone(phone);

      const messageData = {
        session_id: sessionId,
        message_id: msg.key.id,
        jid,
        phone,
        from_me: fromMe,
        push_name: pushName,
        type: content.type,
        body: content.body,
        raw: JSON.stringify(msg),
        contact_id: contact?.id || null,
        timestamp: new Date(timestamp * 1000).toISOString(),
        created_at: new Date().toISOString(),
      };

      // Save to Supabase
      try {
        await supabase('vault_wa_messages', {
          method: 'POST',
          body: messageData,
        });
      } catch (err) {
        console.error(`[DB] Failed to save message:`, err.message);
      }

      // Broadcast via WebSocket
      broadcast('message', { sessionId, message: messageData });

      // Telegram notification for incoming messages
      if (!fromMe) {
        const senderName = pushName || contact?.name || phone;
        const preview = content.body?.substring(0, 200) || `[${content.type}]`;
        notifyTelegram(`WhatsApp from ${senderName}: ${preview}`);
      }
    }
  });

  // ─── Message update handler (read receipts, etc.) ────────────────────

  socket.ev.on('messages.update', async (updates) => {
    for (const update of updates) {
      broadcast('message_update', {
        sessionId,
        messageId: update.key?.id,
        update: update.update,
      });
    }
  });

  // ─── Contacts handler ───────────────────────────────────────────────

  socket.ev.on('contacts.upsert', async (contacts) => {
    for (const contact of contacts) {
      const phone = phoneFromJid(contact.id);
      if (!phone) continue;

      try {
        await supabase('vault_wa_contacts', {
          method: 'POST',
          params: { on_conflict: 'session_id,jid' },
          body: {
            session_id: sessionId,
            jid: contact.id,
            phone,
            name: contact.name || contact.notify || phone,
            notify_name: contact.notify || null,
            updated_at: new Date().toISOString(),
          },
        });
      } catch (err) {
        // Likely conflict, try PATCH
        try {
          await supabase('vault_wa_contacts', {
            method: 'PATCH',
            params: { session_id: `eq.${sessionId}`, jid: `eq.${contact.id}` },
            body: {
              name: contact.name || contact.notify || phone,
              notify_name: contact.notify || null,
              updated_at: new Date().toISOString(),
            },
          });
        } catch (err2) {
          console.error(`[DB] Failed to upsert contact:`, err2.message);
        }
      }
    }
  });

  // ─── Presence handler ───────────────────────────────────────────────

  socket.ev.on('presence.update', ({ id: jid, presences }) => {
    for (const participant in presences) {
      broadcast('presence', {
        sessionId,
        jid,
        participant,
        status: presences[participant].lastKnownPresence,
      });
    }
  });

  return session;
}

// ─── Stop / disconnect a session ─────────────────────────────────────────────

async function stopSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return;

  try {
    session.socket?.end();
    session.socket?.ev?.removeAllListeners();
  } catch (err) {
    console.error(`[Session] Error stopping ${sessionId}:`, err.message);
  }

  session.status = 'disconnected';
  sessions.delete(sessionId);
  await updateSessionStatus(sessionId, 'disconnected');
}

// ─── Auto-reconnect sessions on startup ──────────────────────────────────────

async function autoReconnect() {
  try {
    const rows = await supabase('vault_wa_sessions', {
      params: { status: 'eq.connected', select: 'id,label' },
    });
    if (rows && rows.length > 0) {
      console.log(`[Startup] Auto-reconnecting ${rows.length} session(s)...`);
      for (const row of rows) {
        try {
          await startSession(row.id);
          console.log(`[Startup] Reconnected session ${row.id} (${row.label})`);
        } catch (err) {
          console.error(`[Startup] Failed to reconnect ${row.id}:`, err.message);
        }
      }
    } else {
      console.log('[Startup] No sessions to auto-reconnect');
    }
  } catch (err) {
    console.error('[Startup] Auto-reconnect error:', err.message);
  }
}

// ─── REST API ────────────────────────────────────────────────────────────────

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    sessions: sessions.size,
    wsClients: wsClients.size,
    timestamp: new Date().toISOString(),
  });
});

// List all sessions
app.get('/api/sessions', async (req, res) => {
  try {
    const rows = await supabase('vault_wa_sessions', {
      params: { select: 'id,label,status,phone,name,created_at,updated_at', order: 'created_at.desc' },
    });
    // Augment with live status
    const result = (rows || []).map((row) => {
      const live = sessions.get(row.id);
      return {
        ...row,
        status: live?.status || row.status,
        phone: live?.phone || row.phone,
        name: live?.name || row.name,
        is_live: !!live,
      };
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create new session
app.post('/api/sessions', async (req, res) => {
  try {
    const { label } = req.body;
    if (!label) return res.status(400).json({ error: 'label is required' });

    const rows = await supabase('vault_wa_sessions', {
      method: 'POST',
      body: {
        label,
        status: 'created',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    });

    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Connect session (start Baileys)
app.post('/api/sessions/:id/connect', async (req, res) => {
  try {
    const { id } = req.params;

    // Verify session exists in DB
    const rows = await supabase('vault_wa_sessions', {
      params: { id: `eq.${id}`, select: 'id' },
    });
    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const session = await startSession(id);
    res.json({ status: session.status, message: 'Connection started. Watch WebSocket for QR code.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Disconnect session
app.post('/api/sessions/:id/disconnect', async (req, res) => {
  try {
    const { id } = req.params;
    await stopSession(id);
    res.json({ status: 'disconnected' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete session
app.delete('/api/sessions/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Stop if running
    await stopSession(id);

    // Delete from DB
    await supabase('vault_wa_sessions', {
      method: 'DELETE',
      params: { id: `eq.${id}` },
    });

    // Delete related data
    try {
      await supabase('vault_wa_contacts', { method: 'DELETE', params: { session_id: `eq.${id}` } });
    } catch (_) {}
    try {
      await supabase('vault_wa_messages', { method: 'DELETE', params: { session_id: `eq.${id}` } });
    } catch (_) {}

    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get session status
app.get('/api/sessions/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const live = sessions.get(id);

    const rows = await supabase('vault_wa_sessions', {
      params: { id: `eq.${id}`, select: 'id,label,status,phone,name' },
    });
    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const dbSession = rows[0];
    res.json({
      ...dbSession,
      status: live?.status || dbSession.status,
      phone: live?.phone || dbSession.phone,
      name: live?.name || dbSession.name,
      is_live: !!live,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List chats for session
app.get('/api/sessions/:id/chats', async (req, res) => {
  try {
    const { id } = req.params;
    const session = sessions.get(id);
    if (!session) return res.status(404).json({ error: 'Session not active' });

    const chats = session.store.chats?.all?.() || [];
    const chatList = [];

    for (const chat of chats) {
      if (chat.id === 'status@broadcast') continue;

      const phone = phoneFromJid(chat.id);
      const contact = session.store.contacts?.[chat.id];

      chatList.push({
        jid: chat.id,
        phone,
        name: contact?.name || contact?.notify || chat.name || phone,
        unreadCount: chat.unreadCount || 0,
        lastMessage: chat.conversationTimestamp
          ? {
              timestamp: typeof chat.conversationTimestamp === 'number'
                ? chat.conversationTimestamp
                : chat.conversationTimestamp?.low,
            }
          : null,
        isGroup: chat.id?.endsWith('@g.us') || false,
        pinned: chat.pinned || false,
        archived: chat.archived || false,
        muted: chat.mute ? true : false,
      });
    }

    // Sort by last message timestamp descending
    chatList.sort((a, b) => {
      const ta = a.lastMessage?.timestamp || 0;
      const tb = b.lastMessage?.timestamp || 0;
      return tb - ta;
    });

    res.json(chatList);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get messages for a chat
app.get('/api/sessions/:id/chats/:jid/messages', async (req, res) => {
  try {
    const { id, jid } = req.params;
    const limit = parseInt(req.query.limit) || 50;
    const before = req.query.before || null;

    // Fetch from Supabase (stored messages)
    const params = {
      session_id: `eq.${id}`,
      jid: `eq.${decodeURIComponent(jid)}`,
      select: '*',
      order: 'timestamp.desc',
      limit: String(limit),
    };

    if (before) {
      params.timestamp = `lt.${before}`;
    }

    const messages = await supabase('vault_wa_messages', { params });
    res.json(messages || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Send message
app.post('/api/sessions/:id/chats/:jid/send', async (req, res) => {
  try {
    const { id, jid } = req.params;
    const session = sessions.get(id);
    if (!session || session.status !== 'connected') {
      return res.status(400).json({ error: 'Session not connected' });
    }

    const { type, body, url, caption, mimetype } = req.body;
    const targetJid = decodeURIComponent(jid);
    let sentMsg;

    switch (type) {
      case 'text':
        sentMsg = await session.socket.sendMessage(targetJid, { text: body });
        break;

      case 'image':
        sentMsg = await session.socket.sendMessage(targetJid, {
          image: { url: url },
          caption: caption || '',
          mimetype: mimetype || 'image/jpeg',
        });
        break;

      case 'video':
        sentMsg = await session.socket.sendMessage(targetJid, {
          video: { url: url },
          caption: caption || '',
          mimetype: mimetype || 'video/mp4',
        });
        break;

      case 'document':
        sentMsg = await session.socket.sendMessage(targetJid, {
          document: { url: url },
          mimetype: mimetype || 'application/pdf',
          fileName: body || 'document',
        });
        break;

      case 'audio':
        sentMsg = await session.socket.sendMessage(targetJid, {
          audio: { url: url },
          mimetype: mimetype || 'audio/mp4',
          ptt: req.body.ptt || false,
        });
        break;

      default:
        return res.status(400).json({ error: `Unsupported message type: ${type}` });
    }

    // Save outgoing message to DB
    const content = { type, body: body || caption || '' };
    const phone = phoneFromJid(targetJid);
    const contact = await matchContactByPhone(phone);

    const messageData = {
      session_id: id,
      message_id: sentMsg.key.id,
      jid: targetJid,
      phone,
      from_me: true,
      push_name: session.name || '',
      type: content.type,
      body: content.body,
      raw: JSON.stringify(sentMsg),
      contact_id: contact?.id || null,
      timestamp: new Date().toISOString(),
      created_at: new Date().toISOString(),
    };

    try {
      await supabase('vault_wa_messages', { method: 'POST', body: messageData });
    } catch (err) {
      console.error('[DB] Failed to save outgoing message:', err.message);
    }

    broadcast('message', { sessionId: id, message: messageData });

    res.json({ sent: true, messageId: sentMsg.key.id, message: messageData });
  } catch (err) {
    console.error('[Send] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Mark chat as read
app.post('/api/sessions/:id/chats/:jid/read', async (req, res) => {
  try {
    const { id, jid } = req.params;
    const session = sessions.get(id);
    if (!session || session.status !== 'connected') {
      return res.status(400).json({ error: 'Session not connected' });
    }

    const targetJid = decodeURIComponent(jid);
    await session.socket.readMessages([{ remoteJid: targetJid, id: undefined, participant: undefined }]);
    res.json({ read: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get contacts for session
app.get('/api/sessions/:id/contacts', async (req, res) => {
  try {
    const { id } = req.params;

    // Get from DB
    const contacts = await supabase('vault_wa_contacts', {
      params: { session_id: `eq.${id}`, select: '*', order: 'name.asc' },
    });

    // Also try to get from in-memory store
    const session = sessions.get(id);
    if (session?.store?.contacts) {
      const storeContacts = Object.values(session.store.contacts).map((c) => ({
        jid: c.id,
        phone: phoneFromJid(c.id),
        name: c.name || c.notify || phoneFromJid(c.id),
        notify_name: c.notify || null,
      }));

      // Merge — prefer DB data but add any contacts only in store
      const dbJids = new Set((contacts || []).map((c) => c.jid));
      const extra = storeContacts.filter((c) => !dbJids.has(c.jid));
      res.json([...(contacts || []), ...extra]);
      return;
    }

    res.json(contacts || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get profile picture
app.get('/api/sessions/:id/profile-pic/:jid', async (req, res) => {
  try {
    const { id, jid } = req.params;
    const session = sessions.get(id);
    if (!session || session.status !== 'connected') {
      return res.status(400).json({ error: 'Session not connected' });
    }

    const targetJid = decodeURIComponent(jid);
    try {
      const url = await session.socket.profilePictureUrl(targetJid, 'image');
      res.json({ url });
    } catch (err) {
      // No profile picture available
      res.json({ url: null });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Error handling middleware ────────────────────────────────────────────────

app.use((err, req, res, _next) => {
  console.error('[Express] Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Graceful shutdown ───────────────────────────────────────────────────────

async function shutdown() {
  console.log('\n[Shutdown] Gracefully shutting down...');

  // Disconnect all sessions
  for (const [id] of sessions) {
    try {
      const s = sessions.get(id);
      s?.socket?.end();
    } catch (err) {
      console.error(`[Shutdown] Error stopping session ${id}:`, err.message);
    }
  }
  sessions.clear();

  // Close WebSocket connections
  for (const ws of wsClients) {
    try {
      ws.close();
    } catch (_) {}
  }

  server.close(() => {
    console.log('[Shutdown] Server closed');
    process.exit(0);
  });

  // Force exit after 5 seconds
  setTimeout(() => {
    console.log('[Shutdown] Forced exit');
    process.exit(1);
  }, 5000);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

process.on('uncaughtException', (err) => {
  console.error('[Fatal] Uncaught exception:', err);
});

process.on('unhandledRejection', (err) => {
  console.error('[Fatal] Unhandled rejection:', err);
});

// ─── Start server ────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`\n  VAULT WA Bridge running on http://localhost:${PORT}`);
  console.log(`  WebSocket at ws://localhost:${PORT}/ws`);
  console.log(`  Health check: http://localhost:${PORT}/health\n`);

  // Auto-reconnect saved sessions
  autoReconnect();
});
