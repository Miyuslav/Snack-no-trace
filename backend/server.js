// backend/server.js
"use strict";

const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
require("dotenv").config();

// 🔑 永続ID <-> socket.id の対応
const guestIdBySocketId = new Map(); // socket.id -> guestId
const socketIdByGuestId = new Map(); // guestId -> socket.id

function getGuestIdBySocket(socketId) {
  return guestIdBySocketId.get(socketId) || null;
}

function isActiveGuestSocketId(socketId) {
  if (!activeSession) return false;

  // 旧: socketId が一致
  if (activeSession.guestSocketId === socketId) return true;

  // 新: guestId が一致（復帰・transport close 対策）
  const sidGuestId = getGuestIdBySocket(socketId);
  if (!sidGuestId) return false;

  return activeSession.guestId && activeSession.guestId === sidGuestId;
}

// =========================
// App / Server
// =========================
const app = express();
const server = http.createServer(app);

// Node 20+ は global.fetch あり。無ければ node-fetch fallback
const fetchFn =
  global.fetch ||
  ((...args) => import("node-fetch").then(({ default: f }) => f(...args)));

// =========================
// Stripe
// =========================
const Stripe = require("stripe");
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
const stripe = STRIPE_KEY ? new Stripe(STRIPE_KEY) : null;

console.log("[env] STRIPE_SECRET_KEY exists?", !!process.env.STRIPE_SECRET_KEY);
if (!stripe) console.warn("[Stripe] STRIPE_SECRET_KEY missing: tipping disabled");

// =========================
// Allowed origins（ngrokは毎回変わるので緩めに）
// =========================
const ALLOWED_ORIGINS = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://192.168.1.223:5173",
]);

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (ALLOWED_ORIGINS.has(origin)) return true;

  try {
    const u = new URL(origin);
    if (
      u.hostname.endsWith("ngrok-free.dev") ||
      u.hostname.endsWith("ngrok.app") ||
      u.hostname.endsWith("ngrok.io")
    ) return true;
  } catch {}
  return false;
}

// =========================
// Socket.io（先に作る）
// =========================
const io = new Server(server, {
  path: "/socket.io",
  cors: {
      origin: (origin, cb) => cb(null, isAllowedOrigin(origin)),
      credentials: true,
      methods: ["GET", "POST", "OPTIONS"],
    },
    transports: ["polling", "websocket"],
    pingInterval: 25000,
    pingTimeout: 120000,
  });

  // Express CORS（本番・プレビュー・ローカル）
  app.use(
    cors({
      origin: (origin, cb) => {
        // curl/healthなど origin無しは許可（CORS不要）
        if (!origin) return cb(null, true);

        // 許可なら「true」ではなく「origin文字列」を返す
        if (isAllowedOrigin(origin)) return cb(null, origin);

        // 不許可
        return cb(null, false);
      },
      credentials: true,
      methods: ["GET", "POST", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
    })
  );

  // preflight も同じ設定で返す（重要）
  app.options(
    "*",
    cors({
      origin: (origin, cb) => {
        if (!origin) return cb(null, true);
        if (isAllowedOrigin(origin)) return cb(null, origin);
        return cb(null, false);
      },
      credentials: true,
      methods: ["GET", "POST", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
    })
  );



// =========================
// 状態管理
// =========================
let mamaSocket = null;
const guests = new Map(); // socket.id -> { mood, mode, status, joinedAt, isPaying, roomId }
let waitingOrder = []; // socket.id[]
let activeSession = null; // { guestId, guestSocketId, roomId, startedAt, timeoutId, warningTimeoutId, graceTimeoutId, payingGraceTimeoutId, daily }

const SESSION_MAX_MS = 10 * 60 * 1000;
const WARNING_BEFORE_MS = 60 * 1000;

function broadcastQueueToMama() {
  if (!mamaSocket) return;

  waitingOrder = waitingOrder.filter((sid) => guests.has(sid));

  const queue = waitingOrder.map((sid) => {
    const g = guests.get(sid);
    return {
      socketId: sid,
      mood: g?.mood,
      mode: g?.mode,
      joinedAt: g?.joinedAt,
    };
  });

  mamaSocket.emit("queue.update", queue);
}

function endActiveSession(reason = "ended") {
  if (!activeSession) return;

  clearTimeout(activeSession.timeoutId);
  if (activeSession.warningTimeoutId) clearTimeout(activeSession.warningTimeoutId);
  if (activeSession.payingGraceTimeoutId) clearTimeout(activeSession.payingGraceTimeoutId);
  if (activeSession.graceTimeoutId) clearTimeout(activeSession.graceTimeoutId);

  const guestSocketId = activeSession.guestSocketId;

  const guestInfo = guests.get(guestSocketId);
  if (guestInfo) {
    guestInfo.status = "finished";
    guests.set(guestSocketId, guestInfo);
  }

  console.log("[SESSION END]", { guestSocketId, reason });

  const guestSocket = io.sockets.sockets.get(guestSocketId);
  if (guestSocket) guestSocket.emit("session.ended", { reason });
  if (mamaSocket) mamaSocket.emit("session.ended", { reason });

  activeSession = null;
  broadcastQueueToMama();
}

// =========================
// Daily token（voice用）
// =========================
function roomNameFromUrl(roomUrl) {
  const u = new URL(roomUrl);
  return u.pathname.replace(/^\/+/, "");
}

async function createDailyMeetingToken({ userName, isOwner }) {
  const roomUrl = process.env.DAILY_ROOM_URL;
  const apiKey = process.env.DAILY_API_KEY;

  if (!roomUrl || !apiKey) throw new Error("Missing DAILY_ROOM_URL or DAILY_API_KEY");

  const roomName = roomNameFromUrl(roomUrl);

  const r = await fetchFn("https://api.daily.co/v1/meeting-tokens", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      properties: {
        room_name: roomName,
        user_name: userName || "guest",
        is_owner: !!isOwner,
        exp: Math.floor(Date.now() / 1000) + 60 * 30,
      },
    }),
  });

  const data = await r.json();
  if (!r.ok) throw new Error(`Daily token error: ${r.status} ${JSON.stringify(data)}`);
  return { token: data.token, roomUrl };
}

// =========================
// Session start（Policy A: session.startedにvoiceInfo）
// =========================
async function startSessionWithGuest({ guestId, guestSocketId }) {
   if (activeSession) return;

   const sid = socketIdByGuestId.get(guestId) || guestSocketId; // ✅最新
   const guestInfo = guests.get(sid);
   const guestSocket = io.sockets.sockets.get(sid);
   if (!guestInfo || !guestSocket) return;

   // キューから外す
   waitingOrder = waitingOrder.filter((id) => id !== sid);

   // guest状態
   guestInfo.status = "active";
   guests.set(sid, guestInfo);

   const startedAt = Date.now();

   // voice token (省略: そのまま sid を使う)
   let voiceInfoForGuest = null;
   let voiceInfoForMama = null;
   if (guestInfo.mode === "voice") { /* そのまま */ }

   const timeoutId = setTimeout(() => endActiveSession("timeout"), SESSION_MAX_MS);

   const warningTimeoutId = setTimeout(() => {
     const gSocket = io.sockets.sockets.get(sid); // ✅sid
     if (gSocket) gSocket.emit("session.warning");
     if (mamaSocket) mamaSocket.emit("session.warning", { guestSocketId: sid });
   }, Math.max(1000, SESSION_MAX_MS - WARNING_BEFORE_MS));

   activeSession = {
     guestId,
     guestSocketId: sid,          // ✅sid
     roomId: guestInfo.roomId || null,
     startedAt,
     timeoutId,
     warningTimeoutId,
     graceTimeoutId: null,
     payingGraceTimeoutId: null,
     daily: voiceInfoForGuest && voiceInfoForMama ? { /* そのまま */ } : null,
   };

   console.log("[SESSION START]", { guestSocketId: sid, startedAt });

   guestSocket.emit("session.started", {
     guestSocketId: sid,          // ✅sid
     mood: guestInfo.mood,
     mode: guestInfo.mode,
     roomId: guestInfo.roomId || null,
     startedAt,
     maxMs: SESSION_MAX_MS,
     resumed: false,
     ...(voiceInfoForGuest ? { voiceInfo: voiceInfoForGuest } : {}),
   });

   if (mamaSocket) {
     mamaSocket.emit("session.started", {
       guestSocketId: sid,        // ✅sid
       mood: guestInfo.mood,
       mode: guestInfo.mode,
       roomId: guestInfo.roomId || null,
       startedAt,
       maxMs: SESSION_MAX_MS,
       resumed: false,
       ...(voiceInfoForMama ? { voiceInfo: voiceInfoForMama } : {}),
     });
   }

   broadcastQueueToMama();
 }


// =========================
// Express middleware
// =========================

// ✅ Stripe webhook は raw（json より前）
app.post("/api/stripe-webhook", express.raw({ type: "application/json" }), (req, res) => {
  console.log("[webhook] HIT /api/stripe-webhook");
  if (!stripe) return res.status(400).send("Stripe disabled");

  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("[webhook] signature verify failed", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const roomId = session?.metadata?.roomId;
    const socketId = session?.metadata?.socketId;
    const amountTotal = session.amount_total;

    // isPaying 解除
    if (socketId && guests.has(socketId)) {
      const g = guests.get(socketId);
      g.isPaying = false;
      guests.set(socketId, g);
    }

    if (roomId) {
      io.to(roomId).emit("system_message", {
        id: `tip_${session.id}`,
        type: "tip_paid",
        text: `チップありがとうございます🍺（¥${amountTotal}）`,
        ts: Date.now(),
        kind: "tip",
        amountTotal,
      });
    } else {
      console.warn("⚠️ roomId missing in metadata", {
        checkoutSessionId: session.id,
        metadata: session.metadata,
      });
    }

    if (mamaSocket) {
      mamaSocket.emit("tip.confirmed", {
        amount: amountTotal,
        checkoutSessionId: session.id,
        at: Date.now(),
      });
    }
  }

  return res.json({ received: true });
});

// 通常の JSON は webhook の後
app.use(express.json());

// health check
app.get("/api/health", (req, res) => {
  res.status(200).json({ ok: true, ts: Date.now() });
});

// JSONが無いと req.body が空になるので必須
app.use(express.json());

app.post("/api/create-checkout-session", async (req, res) => {
  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(400).json({ error: "STRIPE_SECRET_KEY missing" });
    }

    const { amount, roomId, socketId } = req.body || {};
    const yen = Number(amount);

    if (!Number.isFinite(yen) || yen <= 0) {
      return res.status(400).json({ error: "invalid amount" });
    }

    const Stripe = require("stripe");
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    // 戻り先（Vercel本番に固定したいならここを固定でもOK）
    const origin = req.get("origin") || "http://localhost:5173";

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "jpy",
            unit_amount: yen,
            product_data: { name: `Tip ¥${yen}` },
          },
        },
      ],
      success_url: `${origin}/return?tip=success&roomId=${encodeURIComponent(roomId || "")}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/return?tip=cancel&roomId=${encodeURIComponent(roomId || "")}`,
      metadata: {
        roomId: String(roomId || ""),
        socketId: String(socketId || ""),
      },
    });

    return res.json({ url: session.url });
  } catch (e) {
    console.error("[TIP] create-checkout-session error:", e);
    return res.status(500).json({ error: e?.message || "server error" });
  }
});


// =========================
// CORS / Allowed origins（統一版）
// =========================
const FRONTEND_ORIGIN = (process.env.FRONTEND_ORIGIN || "").replace(/\/$/, "");

const DEV_ORIGINS = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://192.168.1.223:5173",
]);

function isAllowedOrigin(origin) {
  if (!origin) return true; // curl/health など

  // ✅ 本番（Vercel）を許可
  if (FRONTEND_ORIGIN && origin === FRONTEND_ORIGIN) return true;

  // ✅ ローカル開発
  if (DEV_ORIGINS.has(origin)) return true;

  // ✅ ngrok（開発だけ）
  try {
    const u = new URL(origin);
    if (
      u.hostname.endsWith("ngrok-free.dev") ||
      u.hostname.endsWith("ngrok.app") ||
      u.hostname.endsWith("ngrok.io")
    ) return true;
  } catch {}

  return false;
}


// =========================
// Socket.io handlers
// =========================
io.on("connection", (socket) => {
  const role = socket.handshake.auth?.role || socket.handshake.query?.role || "guest";
  console.log("[SOCKET CONNECT]", socket.id, "role=", role);

  const MAMA_ROOM_ID = process.env.MAMA_ROOM_ID || "room_mama_fixed";

  // ===== mama =====
  if (role === "mama") {
    mamaSocket = socket;
    console.log("Mama connected:", socket.id);

    // ✅ mama は固定部屋に join（サーバ側で実施）
    socket.join(MAMA_ROOM_ID);
    console.log("[mama] join_room", socket.id, MAMA_ROOM_ID);

    broadcastQueueToMama();

    // ✅ 既にセッション中なら復帰情報を送る
    if (activeSession) {
      const gInfo = guests.get(activeSession.guestSocketId);

      socket.emit("session.started", {
        guestSocketId: activeSession.guestSocketId,
        mood: gInfo?.mood ?? null,
        mode: gInfo?.mode ?? null,
        roomId: activeSession.roomId || gInfo?.roomId || null,
        startedAt: activeSession.startedAt,
        maxMs: SESSION_MAX_MS,
        resumed: true,
        ...(activeSession?.daily && gInfo?.mode === "voice"
          ? { voiceInfo: { roomUrl: activeSession.daily.roomUrl, token: activeSession.daily.mamaToken } }
          : {}),
      });

      console.log("[mama resume] sent session.started", {
        mama: socket.id,
        guestSocketId: activeSession.guestSocketId,
        roomId: activeSession.roomId || gInfo?.roomId || null,
      });
    }

    // ✅✅✅ ここが重要：mama 用イベントは mama ブロック内で登録する
    socket.on("mama.acceptGuest", ({ guestSocketId } = {}) => {
      if (!guestSocketId) return;

      const guestId = guestIdBySocketId.get(guestSocketId);
      if (!guestId) {
        console.warn("[accept] guestId not found for socket", { guestSocketId });
        socket.emit("system_message", { text: "⚠️ そのお客さんは既に退店しました（復帰情報なし）。" });
        broadcastQueueToMama();
        return;
      }

      const latestSocketId = socketIdByGuestId.get(guestId);
      const guestSocket = io.sockets.sockets.get(latestSocketId);
      const guestInfo = guests.get(latestSocketId);

      if (!guestSocket || !guestInfo) {
        console.warn("[accept] guest not found", { guestId, latestSocketId });
        socket.emit("system_message", { text: "⚠️ そのお客さんは既に退店しました。キューを更新します。" });
        broadcastQueueToMama();
        return;
      }

      if (activeSession) endActiveSession("mama_switched_guest");

      // ✅ セッション開始
      startSessionWithGuest({ guestId, guestSocketId: latestSocketId });
    });

    socket.on("mama.message", ({ text } = {}) => {
      if (!activeSession) return;
      if (!text) return;

      const guestSocket = io.sockets.sockets.get(activeSession.guestSocketId);
      if (guestSocket) guestSocket.emit("chat.message", { from: "mama", text });
    });

    socket.on("mama.endSession", () => {
      endActiveSession("mama_ended");
    });

    socket.on("voice.join.request", () => {
      if (!activeSession?.daily) {
        socket.emit("voice.join.failed", { message: "音声情報がありません" });
        return;
      }
      socket.emit("voice.join.ready", {
        guestSocketId: activeSession.guestSocketId,
        roomUrl: activeSession.daily.roomUrl,
        token: activeSession.daily.mamaToken,
        resumed: true,
      });
    });

    socket.on("disconnect", (reason) => {
      console.log("[disconnect]", socket.id, "role=", role, "reason=", reason);
      if (socket === mamaSocket) mamaSocket = null;
    });

    return; // ✅ ここで return はOK（登録済みだから）
  }


  // ===== guest init =====
  guests.set(socket.id, {
    mood: null,
    mode: null,
    status: "connected",
    joinedAt: Date.now(),
    isPaying: false,
    roomId: null,
  });

  // join_room
  socket.on("join_room", ({ roomId }) => {
    socket.join(roomId);
    console.log("[join_room]", socket.id, roomId);

    const info = guests.get(socket.id) || {};
    guests.set(socket.id, { ...info, roomId });

    // join_room 内（guest側）
    if (activeSession?.roomId && roomId === activeSession.roomId) {
      const oldId = activeSession.guestSocketId;
      if (oldId !== socket.id) {
        activeSession.guestSocketId = socket.id;

        // ✅ ここで “新しい socket.id の guestInfo”
        const gInfo = guests.get(socket.id);

        socket.emit("session.started", {
          guestSocketId: socket.id,
          mood: gInfo?.mood ?? null,
          mode: gInfo?.mode ?? null,
          roomId: activeSession.roomId || gInfo?.roomId || null,
          startedAt: activeSession.startedAt,
          maxMs: SESSION_MAX_MS,
          resumed: true,
          ...(activeSession.daily && gInfo?.mode === "voice"
            ? { voiceInfo: { roomUrl: activeSession.daily.roomUrl, token: activeSession.daily.guestToken } }
            : {}),
        });

        if (mamaSocket) mamaSocket.emit("system_message", { text: "（ゲストが復帰しました）" });
      }
    }
  });

  // guest.register
  socket.on("guest.register", ({ guestId, mood, mode, roomId } = {}) => {
    if (!guestId) return;

    guestIdBySocketId.set(socket.id, guestId);
    socketIdByGuestId.set(guestId, socket.id);

    const info = guests.get(socket.id) || {};
    guests.set(socket.id, {
      ...info,
      guestId,
      mood,
      mode,
      roomId: roomId || info.roomId || null,
      status: "waiting",
      joinedAt: Date.now(),
    });

    if (!waitingOrder.includes(socket.id)) waitingOrder.push(socket.id);

    console.log("[GUEST REGISTER]", socket.id, { guestId, mood, mode });

    if (mamaSocket) {
      mamaSocket.emit("mama.notify", {
        socketId: socket.id,
        mood,
        mode,
        joinedAt: Date.now(),
      });
    }

    broadcastQueueToMama();

    socket.emit("queue.position", {
      position: waitingOrder.indexOf(socket.id) + 1,
      size: waitingOrder.length,
    });
  });

  // =========================
  // guest.leave（統一版・これ1つだけ残す）
  // =========================
  socket.on("guest.leave", () => {
    const guestInfo = guests.get(socket.id);
    if (!guestInfo) return;

    console.log("[GUEST LEAVE]", socket.id);

    // キューから除外
    waitingOrder = waitingOrder.filter((id) => id !== socket.id);

    // ===== セッション中のゲストか？（guestId基準）=====
    if (activeSession && isActiveGuestSocketId(socket.id)) {

      // 🔥 支払い中は即終了しない
      if (guestInfo.isPaying) {
        if (!activeSession.payingGraceTimeoutId) {
          activeSession.payingGraceTimeoutId = setTimeout(() => {
            endActiveSession("paying_disconnect_timeout");
          }, 2 * 60 * 1000);
        }

        broadcastQueueToMama();
        return;
      }

      // 通常の退店
      endActiveSession("guest_left");
      guests.delete(socket.id);
      broadcastQueueToMama();
      return;
    }

    // セッション外
    guests.delete(socket.id);
    broadcastQueueToMama();
  });

  // guest.message
  socket.on("guest.message", ({ text } = {}) => {
    if (!text) return;

    if (!isActiveGuestSocketId(socket.id)) {
      console.log("[guest.message] ignored (not active)", {
        socketId: socket.id,
        socketGuestId: getGuestIdBySocket(socket.id),
        activeGuestSocketId: activeSession?.guestSocketId,
        activeGuestId: activeSession?.guestId,
      });
      return;
    }

    if (mamaSocket) mamaSocket.emit("chat.message", { from: "guest", text });
  });

  socket.on("guest.tip", ({ amount } = {}) => {
    if (!isActiveGuestSocketId(socket.id)) return;

    const g = guests.get(socket.id);
    if (g) {
      g.isPaying = true;
      guests.set(socket.id, g);
    }
    if (mamaSocket) mamaSocket.emit("guest.tip", { at: Date.now(), amount: amount ?? null });
  });

  // mama.message（念のため残してるが mamaSocket 以外は弾く）
  socket.on("mama.message", ({ text } = {}) => {
    if (socket !== mamaSocket || !activeSession) return;
    if (!text) return;

    const guestSocket = io.sockets.sockets.get(activeSession.guestSocketId);
    if (guestSocket) guestSocket.emit("chat.message", { from: "mama", text });
  });

  // mama.acceptGuest
  socket.on("mama.acceptGuest", ({ guestSocketId } = {}) => {
    if (socket !== mamaSocket) return;
    if (!guestSocketId) return;

    const guestId = guestIdBySocketId.get(guestSocketId);
    if (!guestId) {
      console.warn("[accept] guestId not found for socket", { guestSocketId });
      socket.emit("system_message", { text: "⚠️ そのお客さんは既に退店しました（復帰情報なし）。" });
      broadcastQueueToMama();
      return;
    }

    const latestSocketId = socketIdByGuestId.get(guestId);
    const guestSocket = io.sockets.sockets.get(latestSocketId);
    const guestInfo = guests.get(latestSocketId);

    if (!guestSocket || !guestInfo) {
      console.warn("[accept] guest not found", { guestId, latestSocketId });
      socket.emit("system_message", { text: "⚠️ そのお客さんは既に退店しました。キューを更新します。" });
      broadcastQueueToMama();
      return;
    }

    if (activeSession) endActiveSession("mama_switched_guest");
    startSessionWithGuest({ guestId, guestSocketId: latestSocketId });
  });

  // mama.endSession
  socket.on("mama.endSession", () => {
    if (socket !== mamaSocket) return;
    endActiveSession("mama_ended");
  });

  // voice.join.request（ママ用token再送）
  socket.on("voice.join.request", () => {
    if (socket !== mamaSocket) return;

    if (!activeSession?.daily) {
      socket.emit("voice.join.failed", { message: "音声情報がありません" });
      return;
    }

    socket.emit("voice.join.ready", {
      guestSocketId: activeSession.guestSocketId,
      roomUrl: activeSession.daily.roomUrl,
      token: activeSession.daily.mamaToken,
      resumed: true,
    });
  });

  socket.on("disconnect", (reason) => {
    console.log("[disconnect]", socket.id, "role=", role, "reason=", reason);

    const guestInfo = guests.get(socket.id);
    if (!guestInfo) return;

    waitingOrder = waitingOrder.filter((id) => id !== socket.id);

    if (activeSession && isActiveGuestSocketId(socket.id)) {

      // 🔥 支払い中
      if (guestInfo.isPaying) {
        if (!activeSession.payingGraceTimeoutId) {
          activeSession.payingGraceTimeoutId = setTimeout(() => {
            endActiveSession("paying_disconnect_timeout");
          }, 2 * 60 * 1000);
        }
        return;
      }

      // 通常 disconnect
      if (!activeSession.graceTimeoutId) {
        activeSession.graceTimeoutId = setTimeout(() => {
          endActiveSession("guest_disconnect_timeout");
        }, 10 * 1000);
      }
      return;
    }

    // セッション外
    if (guestInfo.isPaying) {
      setTimeout(() => {
        if (!io.sockets.sockets.get(socket.id)) {
          guests.delete(socket.id);
          broadcastQueueToMama();
        }
      }, 2 * 60 * 1000);
      return;
    }

    guests.delete(socket.id);
    broadcastQueueToMama();
  });
});
// =========================
// Start
// =========================
const PORT = 4000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[BOOT] listening on 0.0.0.0:${PORT}`);
});

// =========================
// Shutdown
// =========================
function shutdown(signal) {
  console.log(`[shutdown] ${signal}`);
  try {
    io.close();
  } catch {}
  server.close(() => {
    console.log("HTTP server closed");
    process.exit(0);
  });
  }
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGQUIT", () => shutdown("SIGQUIT"));
