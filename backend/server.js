// backend/server.js
const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
require("dotenv").config();

const fetchFn =
  global.fetch ||
  ((...args) =>
    import("node-fetch").then(({ default: f }) => f(...args)));

console.log("[env] STRIPE_SECRET_KEY exists?", !!process.env.STRIPE_SECRET_KEY);

const Stripe = require("stripe");
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
const stripe = STRIPE_KEY ? new Stripe(STRIPE_KEY) : null;

if (!stripe) {
  console.warn("[Stripe] STRIPE_SECRET_KEY missing: tipping disabled");
}

console.log("STRIPE_SECRET_KEY =", process.env.STRIPE_SECRET_KEY?.slice(0, 12), "...");

const app = express();

// =========================
// CORS（Express）
/**
 * ✅ ここは「許可したいOriginだけ」にする
 *   - credentials を使うので origin:'*' はNG寄り
 */
// =========================
const ALLOWED_ORIGINS = [
  "http://192.168.1.223:5173",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

app.use(
  cors({
    origin: ALLOWED_ORIGINS,
    credentials: true,
  })
);

// ✅ health（1個に統一）
app.get("/health", (req, res) => res.json({ ok: true }));

// =========================
// Webhook（必ず express.json より前）
// =========================
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

    // ✅ isPaying 解除
    if (socketId && guests.has(socketId)) {
      const g = guests.get(socketId);
      g.isPaying = false;
      guests.set(socketId, g);
    }

    // roomId があれば部屋へ通知
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
      console.warn("⚠️ roomId missing in metadata. cannot post thanks message.", {
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

// =========================
// 通常ミドルウェア（Webhookの後）
// =========================
// JSON body を読む
app.use(express.json());

// ✅ Tip: Checkout Session 作成
app.post("/create-checkout-session", async (req, res) => {
  try {
    const { amount, roomId, guestId } = req.body || {};

    if (!amount || typeof amount !== "number") {
      return res.status(400).json({ error: "amount must be a number" });
    }

    const Stripe = require("stripe");
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    const FRONT_URL =
      process.env.FRONT_URL ||
      `${req.protocol}://${req.get("host")}`; // ざっくり（必要なら固定化）

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "jpy",
            product_data: { name: "Virtual Snack Tip 🍶" },
            unit_amount: amount,
          },
          quantity: 1,
        },
      ],
      metadata: { roomId: roomId || "", guestId: guestId || "" },

      // ✅ ここを変更
        success_url: `${FRONT_URL}/return?tip=success&roomId=${encodeURIComponent(roomId || "")}&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url:  `${FRONT_URL}/return?tip=cancel&roomId=${encodeURIComponent(roomId || "")}`,

    });


    return res.json({ url: session.url });
  } catch (e) {
    console.error("[create-checkout-session] error:", e);
    return res.status(500).json({ error: e.message || "server error" });
  }
});


// =========================
// HTTP server & Socket.io
// =========================
const server = http.createServer(app);

const shutdown = (signal) => {
  console.log(`[shutdown] ${signal}`);
  io?.close?.();          // socket.ioを閉じる
  server.close(() => {
    console.log("HTTP server closed");
    process.exit(0);
  });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("SIGQUIT", shutdown);

const io = new Server(server, {
  cors: {
    origin: true,
    credentials: true,
    methods: ["GET", "POST"],
  },
  transports: ["polling", "websocket"],
  pingInterval: 25000,
  pingTimeout: 60000,
});

// =========================
// 状態管理
// =========================
let mamaSocket = null;              // ママ用ソケット（1人想定）
const guests = new Map();           // socket.id -> { mood, mode, status, joinedAt, isPaying, roomId }
let waitingOrder = [];              // 待機中の guest socket.id の配列
let activeSession = null;           // { guestSocketId, roomId, startedAt, timeoutId, warningTimeoutId, graceTimeoutId, payingGraceTimeoutId, daily }

const SESSION_MAX_MS = 10 * 60 * 1000; // 10分
const WARNING_BEFORE_MS = 60 * 1000;   // 終了1分前

function broadcastQueueToMama() {
  if (!mamaSocket) return;

  // ✅ waitingOrder の死骸掃除（guestsに存在するものだけ）
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

async function createDailyMeetingToken({ userName, isOwner }) {
  const roomUrl = process.env.DAILY_ROOM_URL;
  const apiKey = process.env.DAILY_API_KEY;

  if (!roomUrl || !apiKey) {
    throw new Error("Missing DAILY_ROOM_URL or DAILY_API_KEY");
  }

  const r = await fetchFn("https://api.daily.co/v1/meeting-tokens", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      properties: {
        // ※ Dailyの仕様により room_name / room_url が異なる場合あり
        // ここはあなたの現状踏襲
        room_name: roomUrl,
        user_name: userName || "guest",
        is_owner: !!isOwner,
      },
    }),
  });

  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Daily token create failed: ${r.status} ${text}`);
  }

  const data = await r.json();
  return { roomUrl, token: data.token };
}

function startSessionWithGuest(guestSocketId) {
  if (activeSession) {
    const alive = io.sockets.sockets.get(activeSession.guestSocketId);

    if (!alive) {
      console.log("[stale activeSession cleared]", activeSession.guestSocketId);
      endActiveSession("stale_active_cleared");
    } else {
      console.log("Session already active, cannot start new one.");
      return;
    }
  }

  const guestInfo = guests.get(guestSocketId);
  const guestSocket = io.sockets.sockets.get(guestSocketId);
  if (!guestInfo || !guestSocket) {
    console.log("Guest not found for session start:", guestSocketId);
    return;
  }

  waitingOrder = waitingOrder.filter((id) => id !== guestSocketId);
  guestInfo.status = "active";
  guests.set(guestSocketId, guestInfo);

  const startedAt = Date.now();

  const timeoutId = setTimeout(() => endActiveSession("timeout"), SESSION_MAX_MS);

  const warningTimeoutId = setTimeout(() => {
    const gSocket = io.sockets.sockets.get(guestSocketId);
    if (gSocket) gSocket.emit("session.warning");
    if (mamaSocket) mamaSocket.emit("session.warning", { guestSocketId });
    console.log("[SESSION WARNING]", { guestSocketId });
  }, SESSION_MAX_MS - WARNING_BEFORE_MS);

  activeSession = {
    guestSocketId,
    roomId: guestInfo?.roomId || null,
    startedAt,
    timeoutId,
    warningTimeoutId,
    graceTimeoutId: null,
    payingGraceTimeoutId: null,
    daily: null, // { roomUrl, guestToken, mamaToken }
  };

  console.log("[SESSION START]", { guestSocketId, startedAt });

  guestSocket.emit("session.started", {
    guestSocketId,            // 関数引数の guestSocketId
    mood: guestInfo.mood,
    mode: guestInfo.mode,
    roomId: guestInfo.roomId || null,
    startedAt,
    maxMs: SESSION_MAX_MS,
    resumed: false,
  });

  if (mamaSocket) {
    mamaSocket.emit("session.started", {
      guestSocketId,
      mood: guestInfo.mood,
      mode: guestInfo.mode,
      startedAt,
      maxMs: SESSION_MAX_MS,
    });
  }

  // ===== Daily 音声ルーム（voice のときだけ）=====
  (async () => {
    try {
      if (guestInfo.mode !== "voice") return;

      const guestDaily = await createDailyMeetingToken({
        userName: `guest_${guestSocketId.slice(0, 6)}`,
        isOwner: false,
      });

      const mamaDaily = await createDailyMeetingToken({
        userName: "mama",
        isOwner: true,
      });

      if (activeSession && activeSession.guestSocketId === guestSocketId) {
        activeSession.daily = {
          roomUrl: guestDaily.roomUrl,
          guestToken: guestDaily.token,
          mamaToken: mamaDaily.token,
        };
      }

      // ✅ イベント名統一：voice.join.ready
      guestSocket.emit("voice.join.ready", {
        roomUrl: guestDaily.roomUrl,
        token: guestDaily.token,
      });

      if (mamaSocket) {
        mamaSocket.emit("voice.join.ready", {
          guestSocketId,
          roomUrl: mamaDaily.roomUrl,
          token: mamaDaily.token,
        });
      }

      console.log("[VOICE READY]", { guestSocketId });
    } catch (e) {
      console.error("[VOICE READY] failed", e);

      guestSocket.emit("voice.join.failed", { message: "音声の準備に失敗しました" });
      if (mamaSocket) {
        mamaSocket.emit("voice.join.failed", {
          guestSocketId,
          message: "音声の準備に失敗しました",
        });
      }
    }
  })();

  broadcastQueueToMama();
}

// =========================
// Socket.io
// =========================
io.on("connection", (socket) => {
  const role =
    socket.handshake.auth?.role ||
    socket.handshake.query?.role ||
    "guest";

  console.log("[SOCKET CONNECT]", socket.id, "role=", role, "origin=", socket.handshake.headers.origin);

  // ✅ onAnyは1回だけ（ログ過多を防ぐ）
  socket.onAny((event, ...args) => {
    console.log(`[onAny] ${socket.id} ${role} -> ${event}`, args?.[0]);
  });

  // ===== role 分岐 =====
  if (role === "mama") {
    // 1人運用なら2人目は拒否したい場合はここで切る（任意）
    // if (mamaSocket && mamaSocket.id !== socket.id) {
    //   socket.emit("system_message", { text: "他のママが接続中です" });
    //   socket.disconnect(true);
    //   return;
    // }

    mamaSocket = socket;
    console.log("Mama connected:", socket.id);

    broadcastQueueToMama();

    // セッション中なら復帰情報を送る
    if (activeSession) {
      const gInfo = guests.get(activeSession.guestSocketId);
      mamaSocket.emit("session.started", {
        guestSocketId: activeSession.guestSocketId,
        mood: gInfo?.mood ?? null,
        mode: gInfo?.mode ?? null,
        startedAt: activeSession.startedAt,
        maxMs: SESSION_MAX_MS,
        resumed: true,
      });

      // ✅ セッションが voice なら、ママが「音声の準備」を押せるように ready を返すこともできる（任意）
      // （ただしトークンは request時に返す設計のほうが安全）
    }
  } else {
    guests.set(socket.id, {
      mood: null,
      mode: null,
      status: "connected",
      joinedAt: Date.now(),
      isPaying: false,
      roomId: null,
    });
  }

  // ===== join_room（復帰の要）=====
  socket.on("join_room", ({ roomId } = {}) => {
    if (!roomId) return;

    socket.join(roomId);
    console.log("[join_room]", socket.id, roomId);

    if (role === "mama") return;

    const info = guests.get(socket.id) || {};
    guests.set(socket.id, { ...info, roomId });

    // ✅ セッション中の部屋に復帰してきたら active guest を差し替える
    if (activeSession?.roomId && roomId === activeSession.roomId) {
      const oldId = activeSession.guestSocketId;

      if (oldId !== socket.id) {
        console.log("[session resume] swap active guest", oldId, "->", socket.id);
        activeSession.guestSocketId = socket.id;

        // 猶予タイマー解除
        if (activeSession.graceTimeoutId) {
          clearTimeout(activeSession.graceTimeoutId);
          activeSession.graceTimeoutId = null;
        }
        if (activeSession.payingGraceTimeoutId) {
          clearTimeout(activeSession.payingGraceTimeoutId);
          activeSession.payingGraceTimeoutId = null;
        }

        socket.emit("session.started", {
          startedAt: activeSession.startedAt,
          maxMs: SESSION_MAX_MS,
          resumed: true,
          needsVoiceJoin: true,
        });

        if (mamaSocket) {
          mamaSocket.emit("system_message", { text: "（ゲストが復帰しました）" });
        }

        // ✅ voiceならゲストに再配布（イベント名統一）
        if (activeSession.daily && guests.get(socket.id)?.mode === "voice") {
          setTimeout(() => {
            socket.emit("voice.join.ready", {
              roomUrl: activeSession.daily.roomUrl,
              token: activeSession.daily.guestToken,
              resumed: true,
            });
          }, 0);
        }
      }
    }
  });

  // ===== guest.register =====
  socket.on("guest.register", ({ mood, mode } = {}) => {
    if (role === "mama") return;

    const info = guests.get(socket.id) || {};
    guests.set(socket.id, {
      ...info,
      mood,
      mode,
      status: "waiting",
      joinedAt: Date.now(),
    });

    if (!waitingOrder.includes(socket.id)) waitingOrder.push(socket.id);

    console.log("[GUEST REGISTER]", socket.id, { mood, mode });

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

  // ===== guest.leave（明示退出）=====
  socket.on("guest.leave", () => {
    const guestInfo = guests.get(socket.id);
    if (!guestInfo) return;

    console.log("[GUEST LEAVE]", socket.id);

    waitingOrder = waitingOrder.filter((id) => id !== socket.id);

    if (activeSession && activeSession.guestSocketId === socket.id) {
      endActiveSession("guest_left");
      guests.delete(socket.id);
      broadcastQueueToMama();
      return;
    }

    guests.delete(socket.id);
    broadcastQueueToMama();
    socket.emit("session.ended", { reason: "guest_left" });
  });

  // ===== guest.message =====
  socket.on("guest.message", ({ text } = {}) => {
    if (!text) return;
    if (!activeSession || activeSession.guestSocketId !== socket.id) return;
    if (mamaSocket) mamaSocket.emit("chat.message", { from: "guest", text });
  });

  // ===== guest.tip =====
  socket.on("guest.tip", ({ amount } = {}) => {
    if (!activeSession || activeSession.guestSocketId !== socket.id) return;

    const g = guests.get(socket.id);
    if (g) {
      g.isPaying = true;
      guests.set(socket.id, g);
    }

    if (mamaSocket) {
      mamaSocket.emit("guest.tip", { at: Date.now(), amount: amount ?? null });
    }
  });

  // ===== mama.message =====
  socket.on("mama.message", ({ text } = {}) => {
    if (socket !== mamaSocket || !activeSession) return;
    if (!text) return;

    const guestSocket = io.sockets.sockets.get(activeSession.guestSocketId);
    if (guestSocket) guestSocket.emit("chat.message", { from: "mama", text });
  });

  // ===== mama.acceptGuest =====
  socket.on("mama.acceptGuest", ({ guestSocketId } = {}) => {
    if (socket !== mamaSocket) return;
    if (!guestSocketId) return;

    // ✅ すでにセッション中なら「切り替え」として強制終了してから開始
    if (activeSession) {
      const prev = activeSession.guestSocketId;
      console.log("[accept] switching session", { from: prev, to: guestSocketId });

      // ママ側に通知（UI/ログ用）
      if (mamaSocket) {
        mamaSocket.emit("system_message", {
          text: `🔁 お客さんを切り替えます（${prev.slice(0, 6)}... → ${guestSocketId.slice(0, 6)}...）`,
        });
      }

      endActiveSession("mama_switched_guest");
    }

    // ここで新規セッション開始
    startSessionWithGuest(guestSocketId);
  });

  // ===== mama.endSession =====
  socket.on("mama.endSession", () => {
    if (socket !== mamaSocket) return;
    endActiveSession("mama_ended");
  });

  // ✅ ママが「音声の準備」を押した時にトークンを返す
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

  // ===== disconnect（1本に統一）=====
  socket.on("disconnect", (reason) => {
    console.log("Client disconnected:", socket.id, "role=", role, "reason=", reason);

    // ママが落ちた
    if (socket === mamaSocket) {
      mamaSocket = null;
      return;
    }

    const guestInfo = guests.get(socket.id);
    if (!guestInfo) return;

    waitingOrder = waitingOrder.filter((id) => id !== socket.id);

    // アクティブゲストが落ちた場合
    if (activeSession && activeSession.guestSocketId === socket.id) {
      const g = guests.get(socket.id);

      // 決済中なら2分猶予
      if (g?.isPaying) {
        if (!activeSession.payingGraceTimeoutId) {
          activeSession.payingGraceTimeoutId = setTimeout(() => {
            endActiveSession("paying_disconnect_timeout");
          }, 2 * 60 * 1000);
        }
        return;
      }

      // 通常でも10秒猶予（transport close 対策）
      if (!activeSession.graceTimeoutId) {
        activeSession.graceTimeoutId = setTimeout(() => {
          endActiveSession("guest_disconnect_timeout");
        }, 10 * 1000);
      }
      return;
    }

    // アクティブじゃないゲストなら普通に削除
    guests.delete(socket.id);
    broadcastQueueToMama();
  });
});

// =========================
// API: Checkout Session 作成
// =========================
app.post("/api/create-checkout-session", async (req, res) => {
  try {
    if (!stripe) return res.status(400).json({ error: "Stripe disabled" });

    const { amount, roomId, socketId } = req.body;

    if (!roomId) return res.status(400).json({ error: "roomId is required" });

    const unitAmount = Number(amount);
    if (!Number.isInteger(unitAmount) || unitAmount < 50) {
      return res.status(400).json({ error: "invalid amount" });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card", "paypay"],
      line_items: [
        {
          price_data: {
            currency: "jpy",
            product_data: { name: "チップ" },
            unit_amount: unitAmount,
          },
          quantity: 1,
        },
      ],
      metadata: {
        roomId,
        ...(socketId ? { socketId } : {}),
      },
      success_url: `${process.env.APP_URL}/return?tip=success&roomId=${encodeURIComponent(
        roomId
      )}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.APP_URL}/return?tip=cancel&roomId=${encodeURIComponent(
        roomId
      )}`,
    });

    return res.json({ url: session.url });
  } catch (err) {
    console.error("[create-checkout-session] error", err);
    return res.status(500).json({ error: "failed to create checkout session" });
  }
});

// =========================
// 起動
// =========================
const PORT = process.env.PORT || 4000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`server on ${PORT}`);
});

process.on("SIGINT", () => {
  console.log("SIGINT received, shutting down...");
  server.close(() => process.exit(0));
});
process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down...");
  server.close(() => process.exit(0));
});
