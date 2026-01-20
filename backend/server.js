// backend/server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const io = new Server(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ['GET', 'POST']
  }
});
app.post('/api/stripe-webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[webhook] signature verify failed', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // ✅ 支払い完了の確定（ここが“真”）
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;

    const amountTotal = session.amount_total; // JPYなら「円」
    console.log('✅ TIP PAID', {
      checkoutSessionId: session.id,
      amountTotal,
      metadata: session.metadata,
      created: session.created,
    });

    // ここでDBに積む、ログ保存、合計額を更新、など
    // （ログイン無しなら「累計」だけでもOK）
  }

  res.json({ received: true });
});

app.use(cors({ origin: '*' }));
app.use(express.json());

// =========================
// 状態管理
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
  if (activeSession.warningTimeoutId) {
    clearTimeout(activeSession.warningTimeoutId);
  }

  const guestSocketId = activeSession.guestSocketId;
  const guestInfo = guests.get(guestSocketId);
  if (guestInfo) {
    guestInfo.status = 'finished';
    guests.set(guestSocketId, guestInfo);
  }

  console.log('[SESSION END]', { guestSocketId, reason });

  // ゲストとママ双方へ「終了」を通知
  const guestSocket = io.sockets.sockets.get(guestSocketId);
  if (guestSocket) {
    guestSocket.emit('session.ended', { reason });
  }
  if (mamaSocket) {
    mamaSocket.emit('session.ended', { reason });
  }

  activeSession = null;
  broadcastQueueToMama();
}

function startSessionWithGuest(guestSocketId) {
  if (activeSession) {
    console.log('Session already active, cannot start new one.');
    return;
  }
  const guestInfo = guests.get(guestSocketId);
  const guestSocket = io.sockets.sockets.get(guestSocketId);

  if (!guestInfo || !guestSocket) {
    console.log('Guest not found for session start:', guestSocketId);
    return;
  }

  // 待機キューから削除
  waitingOrder = waitingOrder.filter((id) => id !== guestSocketId);
  guestInfo.status = 'active';
  guests.set(guestSocketId, guestInfo);

  const startedAt = Date.now();

  // 終了タイマー（10分）
  const timeoutId = setTimeout(() => {
    endActiveSession('timeout');
  }, SESSION_MAX_MS);

  // 1分前アラート
  const warningTimeoutId = setTimeout(() => {
    const gSocket = io.sockets.sockets.get(guestSocketId);
    if (gSocket) {
      gSocket.emit('session.warning');
    }
    if (mamaSocket) {
      mamaSocket.emit('session.warning', { guestSocketId });
    }
    console.log('[SESSION WARNING]', { guestSocketId });
  }, SESSION_MAX_MS - WARNING_BEFORE_MS);

  activeSession = {
    guestSocketId,
    startedAt,
    timeoutId,
    warningTimeoutId
  };

  console.log('[SESSION START]', { guestSocketId, startedAt });

  // セッション開始通知
  guestSocket.emit('session.started', {
    startedAt,
    maxMs: SESSION_MAX_MS
  });
  if (mamaSocket) {
    mamaSocket.emit('session.started', {
      guestSocketId,
      mood: guestInfo.mood,
      mode: guestInfo.mode,
      startedAt,
      maxMs: SESSION_MAX_MS
    });
  }

  broadcastQueueToMama();
}

// =========================
// ヘルスチェック
// =========================
app.post('/api/create-checkout-session', async (req, res) => {
  try {
    const { amount } = req.body;

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card', 'paypay'],
      line_items: [
        {
          price_data: {
            currency: 'jpy',
            product_data: { name: 'チップ' },
            unit_amount: amount,
          },
          quantity: 1,
        },
      ],
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

  if (role === 'mama') {
    mamaSocket = socket;
    console.log('Mama connected:', socket.id);
    broadcastQueueToMama();
  } else {
    // ゲストはまだ待機状態ではない（register でキューに入れる）
    guests.set(socket.id, {
      mood: null,
      mode: null,
      status: 'connected',
      joinedAt: Date.now()
    });
  }

  // ゲストが「扉を開ける」時
  socket.on('guest.register', ({ mood, mode }) => {
    if (role === 'mama') return;

    const info = guests.get(socket.id) || {};
    guests.set(socket.id, {
      ...info,
      mood,
      mode,
      status: 'waiting',
      joinedAt: Date.now()
    });

    if (!waitingOrder.includes(socket.id)) {
      waitingOrder.push(socket.id);
    }

    console.log('[GUEST REGISTER]', socket.id, { mood, mode });

    if (mamaSocket) {
      mamaSocket.emit('mama.notify', {
        socketId: socket.id,
        mood,
        mode,
        joinedAt: Date.now()
      });
    }

    broadcastQueueToMama();

    socket.emit('queue.position', {
      position: waitingOrder.indexOf(socket.id) + 1,
      size: waitingOrder.length
    });
  });

   // ★ ゲストが自分から「もう帰る」を押したとき
    socket.on('guest.leave', () => {
      const guestInfo = guests.get(socket.id);
      if (!guestInfo) return;

      console.log('[GUEST LEAVE]', socket.id);

      // 待機キューから削除
      waitingOrder = waitingOrder.filter((id) => id !== socket.id);

      // もしこのゲストがアクティブセッション中なら、セッション終了扱い
      if (activeSession && activeSession.guestSocketId === socket.id) {
        endActiveSession('guest_left');
        // endActiveSession 内で guest/mama 両方に session.ended を飛ばしてくれる
      } else {
        // まだ入店前（待機中）の場合は、ここでクリーンアップ
        guests.delete(socket.id);
        broadcastQueueToMama();
        // ゲスト側にも終了通知を飛ばして「DONE」画面へ
        socket.emit('session.ended', { reason: 'guest_left' });
      }
    });

  // ゲスト → ママ（通常メッセージ）
  socket.on('guest.message', ({ text }) => {
    if (!activeSession || activeSession.guestSocketId !== socket.id) return;
    console.log('guest.message:', text);

    if (mamaSocket) {
      mamaSocket.emit('chat.message', { from: 'guest', text });
    }
  });

  // 💸 ゲスト → ママ（チップ通知）
  socket.on('guest.tip', ({ amount } = {}) => {
    if (!activeSession || activeSession.guestSocketId !== socket.id) return;
    console.log('guest.tip', amount);

    if (mamaSocket) {
      mamaSocket.emit('guest.tip', { at: Date.now(), amount: amount ?? null });
    }
  });

  // ママ → ゲスト
  socket.on('mama.message', ({ text }) => {
    if (socket !== mamaSocket || !activeSession) return;
    const guestSocket = io.sockets.sockets.get(activeSession.guestSocketId);
    console.log('mama.message:', text);

    if (guestSocket) {
      guestSocket.emit('chat.message', { from: 'mama', text });
    }
  });

  // ママが「このお客さんを入店させる」
  socket.on('mama.acceptGuest', ({ guestSocketId }) => {
    if (socket !== mamaSocket) return;
    startSessionWithGuest(guestSocketId);
  });

  // ママが手動でセッション終了
  socket.on('mama.endSession', () => {
    if (socket !== mamaSocket) return;
    endActiveSession('mama_ended');
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);

    if (socket === mamaSocket) {
      mamaSocket = null;
    }

    const guestInfo = guests.get(socket.id);
    if (guestInfo) {
      waitingOrder = waitingOrder.filter((id) => id !== socket.id);

      if (activeSession && activeSession.guestSocketId === socket.id) {
        endActiveSession('guest_disconnected');
      }

      guests.delete(socket.id);
      broadcastQueueToMama();
    }
  });
});

// =========================
// 起動
// =========================
const PORT = process.env.PORT || 4000;

server.listen(PORT, () => {
  console.log(`server on ${PORT}`);
});

