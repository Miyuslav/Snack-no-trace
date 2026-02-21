// backend/server.js
"use strict";

const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
require("dotenv").config();

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
// 永続ID <-> socket.id 対応
// =========================
const guestIdBySocketId = new Map(); // socket.id -> guestId
const socketIdByGuestId = new Map(); // guestId -> socket.id

function getGuestIdBySocket(socketId) {
  return guestIdBySocketId.get(socketId) || null;
}

// =========================
// CORS / Allowed origins（★ここ1箇所に統一）
// =========================
const FRONTEND_ORIGIN = (process.env.FRONTEND_ORIGIN || "").replace(/\/$/, "");

const DEV_ORIGINS = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://192.168.1.223:5173",
]);

function isAllowedOrigin(origin) {
  if (!origin) return true; // curl など（CORS不要）

  // 本番（固定URL）
  if (FRONTEND_ORIGIN && origin === FRONTEND_ORIGIN) return true;

  // Vercel Production（固定URL）
  if (origin === "https://snack-no-trace-frontend.vercel.app") return true;

  // Vercel Preview（プロジェクトの preview を許可）
  try {
    const u = new URL(origin);
    if (
      u.hostname.endsWith(".vercel.app") &&
      u.hostname.startsWith("snack-no-trace-frontend-")
    ) {
      return true;
    }
  } catch {}

  // ローカル開発
  if (DEV_ORIGINS.has(origin)) return true;

  // ngrok（開発だけ）
  try {
    const u = new URL(origin);
    if (
      u.hostname.endsWith("ngrok-free.dev") ||
      u.hostname.endsWith("ngrok.app") ||
      u.hostname.endsWith("ngrok.io")
    ) {
      return true;
    }
  } catch {}

  return false;
}

const corsOptions = {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);

    // ✅ credentials:true のときは "*" ではなく origin 文字列を返す
    if (isAllowedOrigin(origin)) return cb(null, origin);

    return cb(null, false);
  },
  credentials: true,
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

// ✅ Express CORS（routes より前）
app.use(cors(corsOptions));

// ✅ preflight：絶対に cors() 単体を使わない（★ここ重要）
app.options("*", cors(corsOptions));

// =========================
// Stripe
// =========================
const Stripe = require("stripe");
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
const stripe = STRIPE_KEY ? new Stripe(STRIPE_KEY) : null;

console.log("[env] STRIPE_SECRET_KEY exists?", !!process.env.STRIPE_SECRET_KEY);
if (!stripe) console.warn("[Stripe] STRIPE_SECRET_KEY missing: tipping disabled");

// =========================
// Socket.io（Express と同じ CORS 判定）
// =========================
const io = new Server(server, {
  path: "/socket.io",
  cors: {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (isAllowedOrigin(origin)) return cb(null, origin);
      return cb(null, false);
    },
    credentials: true,
    methods: ["GET", "POST", "OPTIONS"],
  },
  transports: ["polling", "websocket"],
  pingInterval: 25000,
  pingTimeout: 120000,
});

// =========================
// 状態管理
// =========================
let mamaSocket = null;
const guests = new Map(); // socket.id -> { guestId, mood, mode, status, joinedAt, isPaying, roomId }
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

function isActiveGuestSocketId(socketId) {
  if (!activeSession) return false;

  // 旧: socketId が一致
  if (activeSession.guestSocketId === socketId) return true;

  // 新: guestId が一致（復帰・transport close 対策）
  const sidGuestId = getGuestIdBySocket(socketId);
  if (!sidGuestId) return false;

  return !!(activeSession.guestId && activeSession.guestId === sidGuestId);
}

function endActiveSession(reason = "ended") {
  if (!activeSession) return;

  clearTimeout(activeSession.timeoutId);
  if (activeSession.warningTimeoutId) clearTimeout(activeSession.warningTimeoutId);
  if (activeSession.payingGraceTimeoutId) clearTimeout(activeSession.payingGraceTimeoutId);
  if (activeSession.graceTimeoutId) clearTimeout(activeSession.graceTimeoutId);

  const sid =
    (activeSession.guestId && socketIdByGuestId.get(activeSession.guestId)) ||
    activeSession.guestSocketId;

  const guestInfo = guests.get(sid);
  if (guestInfo) {
    guestInfo.status = "finished";
    guests.set(sid, guestInfo);
  }

  console.log("[SESSION END]", { guestSocketId: sid, reason });

  const guestSocket = io.sockets.sockets.get(sid);
  if (guestSocket) guestSocket.emit("session.ended", { reason });
  if (mamaSocket) mamaSocket.emit("session.ended", { reason });

  activeSession = null;
  broadcastQueueToMama();
}

// =========================
// Daily token（voice用）※必要なら中身を実装
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

  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Daily token error: ${r.status} ${JSON.stringify(data)}`);
  return { token: data.token, roomUrl };
}

// =========================
// Session start
// =========================
async function startSessionWithGuest({ guestId, guestSocketId }) {
  if (activeSession) return;

  const sid = socketIdByGuestId.get(guestId) || guestSocketId;
  const guestInfo = guests.get(sid);
  const guestSocket = io.sockets.sockets.get(sid);
  if (!guestInfo || !guestSocket) return;

  waitingOrder = waitingOrder.filter((id) => id !== sid);

  guestInfo.status = "active";
  guests.set(sid, guestInfo);

  const startedAt = Date.now();

  let voiceInfoForGuest = null;
  let voiceInfoForMama = null;
  let voiceError = null;

  // voice の場合だけ発行したいならここ
  if (guestInfo.mode === "voice") {
    console.log("[Daily] start token create", {
        guestSocketId: sid,
        roomUrlSet: !!process.env.DAILY_ROOM_URL,
        apiKeySet: !!process.env.DAILY_API_KEY,
        roomUrl: process.env.DAILY_ROOM_URL || "(missing)",
      });

    try {
      const gTok = await createDailyMeetingToken({ userName: "guest", isOwner: false });
      const mTok = await createDailyMeetingToken({ userName: "mama", isOwner: true });
      voiceInfoForGuest = { roomUrl: gTok.roomUrl, token: gTok.token };
      voiceInfoForMama = { roomUrl: mTok.roomUrl, token: mTok.token };
      console.log("[Daily] token created OK", {
            roomUrl: voiceInfoForGuest.roomUrl,
            guestTokenLen: voiceInfoForGuest.token?.length,
            mamaTokenLen: voiceInfoForMama.token?.length,
          });
    } catch (e) {
      console.warn("[Daily] token create failed:", e);
      console.warn("[Daily] env", {
        DAILY_ROOM_URL: process.env.DAILY_ROOM_URL ? "(set)" : "(missing)",
        DAILY_API_KEY: process.env.DAILY_API_KEY ? "(set)" : "(missing)",
      });
    }

  const timeoutId = setTimeout(() => endActiveSession("timeout"), SESSION_MAX_MS);

  const warningTimeoutId = setTimeout(() => {
    const gSocket = io.sockets.sockets.get(sid);
    if (gSocket) gSocket.emit("session.warning");
    if (mamaSocket) mamaSocket.emit("session.warning", { guestSocketId: sid });
  }, Math.max(1000, SESSION_MAX_MS - WARNING_BEFORE_MS));

  activeSession = {
    guestId,
    guestSocketId: sid,
    roomId: guestInfo.roomId || null,
    startedAt,
    timeoutId,
    warningTimeoutId,
    graceTimeoutId: null,
    payingGraceTimeoutId: null,
    daily:
      voiceInfoForGuest && voiceInfoForMama
        ? { roomUrl: voiceInfoForGuest.roomUrl, guestToken: voiceInfoForGuest.token, mamaToken: voiceInfoForMama.token }
        : null,
  };

  console.log("[SESSION START]", { guestSocketId: sid, startedAt });

  if (guestInfo.mode === "voice") {
    try {
      const gTok = await createDailyMeetingToken({ userName: "guest", isOwner: false });
      const mTok = await createDailyMeetingToken({ userName: "mama", isOwner: true });
      voiceInfoForGuest = { roomUrl: gTok.roomUrl, token: gTok.token };
      voiceInfoForMama  = { roomUrl: mTok.roomUrl, token: mTok.token };
    } catch (e) {
      voiceError = e?.message || "Daily token create failed";
      console.warn("[Daily] token create failed:", e);
    }
  }


  guestSocket.emit("session.started", {
    guestSocketId: sid,
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
      guestSocketId: sid,
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
// Express routes
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
    }

    if (mamaSocket) {
      mamaSocket.emit("tip.confirmed", {
        amount: amountTotal,
        checkoutSessionId: session.id,
        at: Date.now(),
      });
    }

    console.log("[webhook] tip completed", { roomId, socketId, amountTotal });
  }

  return res.json({ received: true });
});

// ✅ JSON は webhook の後
app.use(express.json());

// health
app.get("/api/health", (req, res) => {
  res.status(200).json({ ok: true, ts: Date.now() });
});

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

    const stripeLocal = new Stripe(process.env.STRIPE_SECRET_KEY);

    // 戻り先：Originが来るならそれ、無ければ本番固定へ
    const origin = req.get("origin") || FRONTEND_ORIGIN || "http://localhost:5173";

    const session = await stripeLocal.checkout.sessions.create({
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

    socket.join(MAMA_ROOM_ID);
    console.log("[mama] join_room", socket.id, MAMA_ROOM_ID);

    broadcastQueueToMama();

    if (activeSession) {
      const gInfo = guests.get(activeSession.guestSocketId);

      console.log("[VOICE DEBUG] mode=", gInfo?.mode,
        "hasDaily=", !!activeSession?.daily,
        "daily=", activeSession?.daily);


      guestSocket.emit("session.started", {
        guestSocketId: activeSession.guestSocketId,
        mood: gInfo?.mood ?? null,
        mode: gInfo?.mode ?? null,
        roomId: activeSession.roomId || gInfo?.roomId || null,
        startedAt: activeSession.startedAt,
        maxMs: SESSION_MAX_MS,
        resumed: true,
        ...(activeSession?.daily && gInfo?.mode === "voice"
          ? { voiceInfo: { roomUrl: activeSession.daily.roomUrl, token: activeSession.daily.guestToken } }
          : {}),
      });
    }

    socket.on("mama.acceptGuest", ({ guestSocketId } = {}) => {
      if (!guestSocketId) return;

      const guestId = guestIdBySocketId.get(guestSocketId);
      if (!guestId) {
        socket.emit("system_message", { text: "⚠️ そのお客さんは既に退店しました。" });
        broadcastQueueToMama();
        return;
      }

      const latestSocketId = socketIdByGuestId.get(guestId);
      const guestSocket = io.sockets.sockets.get(latestSocketId);
      const guestInfo = guests.get(latestSocketId);

      if (!guestSocket || !guestInfo) {
        socket.emit("system_message", { text: "⚠️ そのお客さんは既に退店しました。キュー更新します。" });
        broadcastQueueToMama();
        return;
      }

      if (activeSession) endActiveSession("mama_switched_guest");
      startSessionWithGuest({ guestId, guestSocketId: latestSocketId });
    });

    socket.on("mama.message", ({ text } = {}) => {
      if (!activeSession || !text) return;
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

    return;
  }

  // ===== guest init =====
  guests.set(socket.id, {
    guestId: null,
    mood: null,
    mode: null,
    status: "connected",
    joinedAt: Date.now(),
    isPaying: false,
    roomId: null,
  });

  socket.on("join_room", ({ roomId }) => {
    socket.join(roomId);
    console.log("[join_room]", socket.id, roomId);

    const info = guests.get(socket.id) || {};
    guests.set(socket.id, { ...info, roomId });

    if (activeSession?.roomId && roomId === activeSession.roomId) {
      const oldId = activeSession.guestSocketId;
      if (oldId !== socket.id) {
        activeSession.guestSocketId = socket.id;

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

    if (mamaSocket) mamaSocket.emit("mama.notify", { socketId: socket.id, mood, mode, joinedAt: Date.now() });
    broadcastQueueToMama();

    socket.emit("queue.position", { position: waitingOrder.indexOf(socket.id) + 1, size: waitingOrder.length });
  });

  socket.on("guest.leave", () => {
    const guestInfo = guests.get(socket.id);
    if (!guestInfo) return;

    console.log("[GUEST LEAVE]", socket.id);

    waitingOrder = waitingOrder.filter((id) => id !== socket.id);

    if (activeSession && isActiveGuestSocketId(socket.id)) {
      if (guestInfo.isPaying) {
        if (!activeSession.payingGraceTimeoutId) {
          activeSession.payingGraceTimeoutId = setTimeout(() => endActiveSession("paying_disconnect_timeout"), 2 * 60 * 1000);
        }
        broadcastQueueToMama();
        return;
      }

      endActiveSession("guest_left");
      guests.delete(socket.id);
      broadcastQueueToMama();
      return;
    }

    guests.delete(socket.id);
    broadcastQueueToMama();
  });

  socket.on("guest.message", ({ text } = {}) => {
    if (!text) return;

    if (!isActiveGuestSocketId(socket.id)) return;
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

  socket.on("disconnect", (reason) => {
    console.log("[disconnect]", socket.id, "role=", role, "reason=", reason);

    const guestInfo = guests.get(socket.id);
    if (!guestInfo) return;

    waitingOrder = waitingOrder.filter((id) => id !== socket.id);

    if (activeSession && isActiveGuestSocketId(socket.id)) {
      if (guestInfo.isPaying) {
        if (!activeSession.payingGraceTimeoutId) {
          activeSession.payingGraceTimeoutId = setTimeout(() => endActiveSession("paying_disconnect_timeout"), 2 * 60 * 1000);
        }
        return;
      }

      if (!activeSession.graceTimeoutId) {
        activeSession.graceTimeoutId = setTimeout(() => endActiveSession("guest_disconnect_timeout"), 10 * 1000);
      }
      return;
    }

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
const PORT = Number(process.env.PORT || 4000);

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
