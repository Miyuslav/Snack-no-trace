// backend/server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
require('dotenv').config();

const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: true, // ✅ どのoriginも許可（開発用）
    methods: ["GET", "POST"],
    credentials: true,
  },
  transports: ["websocket", "polling"], // ✅ スマホ安定化
  pingInterval: 25000,
  pingTimeout: 60000,

  // ✅ 追加：短時間切断から復帰
  connectionStateRecovery: {
    maxDisconnectionDuration: 60_000, // 60秒以内の切断は復帰対象
    skipMiddlewares: true,
    },
});


// =========================
// 状態管理（Socketより前でも後でもOK）
// =========================
let mamaSocket = null;              // ママ用ソケット（1人想定）
const guests = new Map();           // socket.id -> { mood, mode, status, joinedAt }
let waitingOrder = [];              // 待機中の guest socket.id の配列
let activeSession = null;           // { guestSocketId, startedAt, timeoutId, warningTimeoutId }

const SESSION_MAX_MS = 10 * 60 * 1000; // 10分
const WARNING_BEFORE_MS = 60 * 1000;   // 終了1分前

function broadcastQueueToMama() {
  if (!mamaSocket) return;
  const queue = waitingOrder.map((sid) => {
    const g = guests.get(sid);
    return {
      socketId: sid,
      mood: g?.mood,
      mode: g?.mode,
      joinedAt: g?.joinedAt
    };
  });
  mamaSocket.emit('queue.update', queue);
}

function endActiveSession(reason = 'ended') {
  if (!activeSession) return;

  clearTimeout(activeSession.timeoutId);
  if (activeSession.warningTimeoutId) clearTimeout(activeSession.warningTimeoutId)
  if (activeSession.payingGraceTimeoutId) clearTimeout(activeSession.payingGraceTimeoutId);
  if (activeSession.graceTimeoutId) clearTimeout(activeSession.graceTimeoutId);
  const guestSocketId = activeSession.guestSocketId;
  const guestInfo = guests.get(guestSocketId);
  if (guestInfo) {
    guestInfo.status = 'finished';
    guests.set(guestSocketId, guestInfo);
  }

  console.log('[SESSION END]', { guestSocketId, reason });

  const guestSocket = io.sockets.sockets.get(guestSocketId);
  if (guestSocket) guestSocket.emit('session.ended', { reason });
  if (mamaSocket) mamaSocket.emit('session.ended', { reason });

  activeSession = null;
  broadcastQueueToMama();
}

function startSessionWithGuest(guestSocketId) {
  if (activeSession) {
    const alive = io.sockets.sockets.get(activeSession.guestSocketId);

    if (!alive) {
      console.log('[stale activeSession cleared]', activeSession.guestSocketId);
      endActiveSession('stale_active_cleared'); // ← タイマーも掃除できる
    } else {
      console.log('Session already active, cannot start new one.');
      return;
    }
  }

  const guestInfo = guests.get(guestSocketId);
  const guestSocket = io.sockets.sockets.get(guestSocketId);
  if (!guestInfo || !guestSocket) {
    console.log('Guest not found for session start:', guestSocketId);
    return;
  }

  waitingOrder = waitingOrder.filter((id) => id !== guestSocketId);
  guestInfo.status = 'active';
  guests.set(guestSocketId, guestInfo);

  const startedAt = Date.now();

  const timeoutId = setTimeout(
    () => endActiveSession('timeout'),
    SESSION_MAX_MS
  );

  const warningTimeoutId = setTimeout(() => {
    const gSocket = io.sockets.sockets.get(guestSocketId);
    if (gSocket) gSocket.emit('session.warning');
    if (mamaSocket) mamaSocket.emit('session.warning', { guestSocketId });
    console.log('[SESSION WARNING]', { guestSocketId });
  }, SESSION_MAX_MS - WARNING_BEFORE_MS);

  activeSession = {
    guestSocketId,
    roomId: guestInfo?.roomId || null,
    startedAt,
    timeoutId,
    warningTimeoutId,
    graceTimeoutId: null,
    payingGraceTimeoutId: null,
  };

  console.log('[SESSION START]', { guestSocketId, startedAt });

  guestSocket.emit('session.started', {
    startedAt,
    maxMs: SESSION_MAX_MS,
  });

  if (mamaSocket) {
    mamaSocket.emit('session.started', {
      guestSocketId,
      mood: guestInfo.mood,
      mode: guestInfo.mode,
      startedAt,
      maxMs: SESSION_MAX_MS,
    });
  }

  broadcastQueueToMama();
}


// =========================
// Webhook（必ず express.json より前）
// =========================
app.post('/api/stripe-webhook', express.raw({ type: 'application/json' }), (req, res) => {
  console.log('[webhook] HIT /api/stripe-webhook');

  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('[webhook] signature verify failed', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;

    const roomId = session?.metadata?.roomId;
    const socketId = session?.metadata?.socketId;   // ← 追加
    const amountTotal = session.amount_total;

    // ✅ 決済完了したら isPaying を解除（roomId の有無と無関係）
    if (socketId && guests.has(socketId)) {
      const g = guests.get(socketId);
      g.isPaying = false;
      guests.set(socketId, g);
    }

    // roomId があれば部屋へ通知
    if (roomId) {
      io.to(roomId).emit('system_message', {
        id: `tip_${session.id}`,
        type: 'tip_paid',
        text: `チップありがとうございます🍺（¥${amountTotal}）`,
        ts: Date.now(),
        kind: 'tip',
        amountTotal,
      });
    } else {
      console.warn('⚠️ roomId missing in metadata. cannot post thanks message.', {
        checkoutSessionId: session.id,
        metadata: session.metadata,
      });
    }

    if (mamaSocket) {
      mamaSocket.emit('tip.confirmed', {
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
app.use(cors({ origin: '*' }));
app.use(express.json());

// =========================
// API: Checkout Session 作成
// =========================
app.post('/api/create-checkout-session', async (req, res) => {
  try {
    const { amount, roomId, socketId } = req.body; // socketId を使うならここで受け取る

    if (!roomId) return res.status(400).json({ error: 'roomId is required' });

    const unitAmount = Number(amount);
    if (!Number.isInteger(unitAmount) || unitAmount < 50) {
      return res.status(400).json({ error: 'invalid amount' });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card', 'paypay'],
      line_items: [
        {
          price_data: {
            currency: 'jpy',
            product_data: { name: 'チップ' },
            unit_amount: unitAmount,
          },
          quantity: 1,
        },
      ],
      metadata: {
        roomId,
        ...(socketId ? { socketId } : {}),
      },
      success_url: `${process.env.APP_URL}/return?tip=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${process.env.APP_URL}/return?tip=cancel`,
    });

    return res.json({ url: session.url });
  } catch (err) {
    console.error('[create-checkout-session] error', err);
    return res.status(500).json({ error: 'failed to create checkout session' });
  }
});
// =========================
// Socket.io
// =========================
io.on('connection', (socket) => {
  const role = socket.handshake.query.role || 'guest';
  console.log('Client connected:', socket.id, 'role=', role);

  // ===== role 分岐 =====
  if (role === 'mama') {
    mamaSocket = socket;
    console.log('Mama connected:', socket.id);

    broadcastQueueToMama();

    // セッション中なら復帰情報を送る
    if (activeSession) {
      const gInfo = guests.get(activeSession.guestSocketId);
      mamaSocket.emit('session.started', {
        guestSocketId: activeSession.guestSocketId,
        mood: gInfo?.mood ?? null,
        mode: gInfo?.mode ?? null,
        startedAt: activeSession.startedAt,
        maxMs: SESSION_MAX_MS,
        resumed: true,
      });
    }
  } else {
    guests.set(socket.id, {
      mood: null,
      mode: null,
      status: 'connected',
      joinedAt: Date.now(),
      isPaying: false,
      roomId: null,
    });
  }

  // ===== join_room（復帰の要）=====
  socket.on('join_room', ({ roomId } = {}) => {
    if (!roomId) return;

    socket.join(roomId);
    console.log('[join_room]', socket.id, roomId);

    if (role !== 'mama') {
      const info = guests.get(socket.id) || {};
      guests.set(socket.id, { ...info, roomId });

      // ✅ セッション中の部屋に復帰してきたら active guest を差し替える
      if (activeSession?.roomId && roomId === activeSession.roomId) {
        const oldId = activeSession.guestSocketId;

        if (oldId !== socket.id) {
          console.log('[session resume] swap active guest', oldId, '->', socket.id);
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

          // ゲストへ再通知（フロント復帰用）
          socket.emit('session.started', {
            startedAt: activeSession.startedAt,
            maxMs: SESSION_MAX_MS,
            resumed: true,
          });

          if (mamaSocket) {
            mamaSocket.emit('system_message', { text: '（ゲストが復帰しました）' });
          }
        }
      }
    }
  });

  // ===== guest.register =====
  socket.on('guest.register', ({ mood, mode } = {}) => {
    if (role === 'mama') return;

    const info = guests.get(socket.id) || {};
    guests.set(socket.id, {
      ...info,
      mood,
      mode,
      status: 'waiting',
      joinedAt: Date.now(),
    });

    if (!waitingOrder.includes(socket.id)) waitingOrder.push(socket.id);

    console.log('[GUEST REGISTER]', socket.id, { mood, mode });

    if (mamaSocket) {
      mamaSocket.emit('mama.notify', {
        socketId: socket.id,
        mood,
        mode,
        joinedAt: Date.now(),
      });
    }

    broadcastQueueToMama();

    socket.emit('queue.position', {
      position: waitingOrder.indexOf(socket.id) + 1,
      size: waitingOrder.length,
    });
  });

  // ===== guest.leave（明示退出）=====
  socket.on('guest.leave', () => {
    const guestInfo = guests.get(socket.id);
    if (!guestInfo) return;

    console.log('[GUEST LEAVE]', socket.id);

    waitingOrder = waitingOrder.filter((id) => id !== socket.id);

    if (activeSession && activeSession.guestSocketId === socket.id) {
      endActiveSession('guest_left');
      guests.delete(socket.id);
      broadcastQueueToMama();
      return;
    }

    guests.delete(socket.id);
    broadcastQueueToMama();
    socket.emit('session.ended', { reason: 'guest_left' });
  });

  // ===== guest.message =====
  socket.on('guest.message', ({ text } = {}) => {
    if (!text) return;

    if (!activeSession || activeSession.guestSocketId !== socket.id) return;
    if (mamaSocket) mamaSocket.emit('chat.message', { from: 'guest', text });
  });

  // ===== guest.tip =====
  socket.on('guest.tip', ({ amount } = {}) => {
    if (!activeSession || activeSession.guestSocketId !== socket.id) return;

    const g = guests.get(socket.id);
    if (g) {
      g.isPaying = true;
      guests.set(socket.id, g);
    }

    if (mamaSocket) {
      mamaSocket.emit('guest.tip', { at: Date.now(), amount: amount ?? null });
    }
  });

  // ===== mama.message =====
  socket.on('mama.message', ({ text } = {}) => {
    if (socket !== mamaSocket || !activeSession) return;
    if (!text) return;

    const guestSocket = io.sockets.sockets.get(activeSession.guestSocketId);
    if (guestSocket) guestSocket.emit('chat.message', { from: 'mama', text });
  });

  // ===== mama.acceptGuest =====
  socket.on('mama.acceptGuest', ({ guestSocketId } = {}) => {
    if (socket !== mamaSocket) return;
    if (!guestSocketId) return;

    if (activeSession) {
      const alive = io.sockets.sockets.get(activeSession.guestSocketId);
      if (!alive) {
        console.log('[accept] stale activeSession cleared', activeSession.guestSocketId);
        endActiveSession('stale_active_cleared');
      } else {
        console.log('[accept ignored] session already active', activeSession.guestSocketId);
        return;
      }
    }

    startSessionWithGuest(guestSocketId);
  });

  // ===== mama.endSession =====
  socket.on('mama.endSession', () => {
    if (socket !== mamaSocket) return;
    endActiveSession('mama_ended');
  });

  // ===== disconnect =====
  socket.on('disconnect', (reason) => {
    console.log('Client disconnected:', socket.id, 'reason=', reason);

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
            endActiveSession('paying_disconnect_timeout');
          }, 2 * 60 * 1000);
        }
        return;
      }

      // ✅ 通常でも10秒猶予（transport close 対策）
      if (!activeSession.graceTimeoutId) {
        activeSession.graceTimeoutId = setTimeout(() => {
          endActiveSession('guest_disconnect_timeout');
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
    // 起動（必ず io.on の外）
    // =========================
    const PORT = process.env.PORT || 4000;
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`server on ${PORT}`);
    });
