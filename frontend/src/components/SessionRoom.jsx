// frontend/src/components/SessionRoom.jsx
import React, { useState, useEffect, useRef } from 'react';
import { socket } from '../socket';

const TIP_OPTIONS = [100, 300, 500];
const SessionRoom = ({ sessionInfo, onLeave }) => {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState([]);
  const [tipEffect, setTipEffect] = useState(false);

  const [tipOpen, setTipOpen] = useState(false);
  const [tipLoading, setTipLoading] = useState(false);
  const [showCloseButton, setShowCloseButton] = useState(false);

  const cheersSoundRef = useRef(null);
  const leaveSoundRef = useRef(null);
  const tipTimerRef = useRef(null);
  const roomIdRef = useRef(null);
  const payWinRef = useRef(null);


  useEffect(() => {
    // 1) sessionInfo に roomId があればそれを使う
    // 2) 無ければ localStorage に固定IDを作って使う（匿名・非保存のまま）
    const key = 'snack_room_id';
    const existing = sessionInfo?.roomId || window.localStorage.getItem(key);
    const rid = existing || `room_${crypto.randomUUID()}`;
    roomIdRef.current = rid;
    window.localStorage.setItem(key, rid);

    // join
    socket.emit('join_room', { roomId: rid });
  }, [sessionInfo?.roomId]);

  useEffect(() => {
    return () => {
      if (tipTimerRef.current) window.clearTimeout(tipTimerRef.current);
    };
  }, []);


  const addMessage = (from, text) => {
    setMessages((prev) => [...prev, { id: prev.length + 1, from, text }]);
  };

  // 🍸 乾杯音
  useEffect(() => {
    const a = new Audio('/kanpai.mp3');
    a.volume = 0.6;
    cheersSoundRef.current = a;
    return () => {
      a.pause();
      a.src = '';
      cheersSoundRef.current = null;
    };
  }, []);

  // 🚪 退出音
  useEffect(() => {
    const a = new Audio('/open.mp3');
    a.volume = 0.55;
    leaveSoundRef.current = a;
    return () => {
      a.pause();
      a.src = '';
      leaveSoundRef.current = null;
    };
  }, []);

  // 入店時のあいさつ
  useEffect(() => {
    const greeting =
      sessionInfo?.mood === 'relax'
        ? '癒やされたい'
        : sessionInfo?.mood === 'listen'
        ? '話を聞いてほしい'
        : sessionInfo?.mood === 'advise'
        ? '悩みを相談したい'
        : 'お話';

    addMessage('mama', `いらっしゃい。今日は「${greeting}」気分なのね。ゆっくりしてらしてね。`);
    // silent-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ママからのチャットメッセージ
  useEffect(() => {
    const handler = ({ from, text }) => {
      if (from === 'mama') addMessage('mama', text);
    };
    socket.on('chat.message', handler);
    return () => socket.off('chat.message', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 1分前アラート
  useEffect(() => {
    const onWarning = () => addMessage('system', '⏰あと1分でセッションが終了しちゃう...。');
    socket.on('session.warning', onWarning);
    return () => socket.off('session.warning', onWarning);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onSystemMessage = (m) => {
      console.log('[socket] system_message', m);
      if (m?.text) addMessage('system', m.text);

      // ✅ 決済完了の合図でポップアップを閉じる（最重要）
      // ここは「あなたの webhook が流してくる文言」に合わせて条件を調整してOK
      const isTipThanks =
        m?.type === 'tip_paid';

      if (isTipThanks) {
        try {
          if (payWinRef.current && !payWinRef.current.closed) {
            payWinRef.current.close();
          }
        } catch (e) {
          console.warn('pay popup close failed', e);
        } finally {
          payWinRef.current = null;
        }
      }
    };

    socket.on('system_message', onSystemMessage);
    return () => socket.off('system_message', onSystemMessage);
  }, []);


  // tip=success/cancel（Stripe戻り）を拾う
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tip = params.get('tip');

    if (tip !== 'success' && tip !== 'cancel') return;

    if (tip === 'success') {
      setTipEffect(true);
      setTimeout(() => setTipEffect(false), 1200);
    }

    const isTipPopup =
      window.name === 'tip_popup' ||
      (() => {
        try { return window.sessionStorage.getItem('tip_popup') === '1'; } catch { return false; }
      })();


    if (isTipPopup) {
      // 自動クローズを試す
      setTimeout(() => {
        window.close();
      }, 400);

      // 保険として「閉じるボタン」を出す
      setShowCloseButton(true);
      return;
    }

    // メインタブだけ URL を戻す
    window.history.replaceState({}, '', '/session');
  }, []);

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    addMessage('user', trimmed);
    setInput('');
    socket.emit('guest.message', { text: trimmed });
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSend();
    }
  };

  const handleCheers = () => {
    // 客側の乾杯（今まで通り）
    if (cheersSoundRef.current) {
      try {
        cheersSoundRef.current.currentTime = 0;
        cheersSoundRef.current.play();
      } catch (e) {
        console.warn('cheers sound play error', e);
      }
    }

    const userText = '🍸 乾杯！';
    addMessage('user', userText);
    socket.emit('guest.message', { text: userText });

    // 👩 ママ側の乾杯を3秒後に自動発火
    window.setTimeout(() => {
      // ママの効果音（同じ音でOK）
      if (cheersSoundRef.current) {
        try {
          cheersSoundRef.current.currentTime = 0;
          cheersSoundRef.current.play();
        } catch (e) {
          console.warn('mama cheers sound error', e);
        }
      }

      // ママのメッセージ
      addMessage('mama', '🍸 乾杯！');

      // 必要ならエフェクトも
      setTipEffect(true);
      setTimeout(() => setTipEffect(false), 900);
    }, 3000);
  };


  const handleConsult = () => {
    const text = '💬 ちょっと相談したいことがあるんだ。';
    addMessage('user', text);
    socket.emit('guest.message', { text });
  };

  const handleTip = () => {
    setTipOpen(true);
  };

  const startTipPayment = async (amount) => {
    // ✅ クリック直後にタブ確保（ポップアップブロック回避）
    const payWin = window.open('about:blank', '_blank');
    payWinRef.current = payWin;

    try {
      // ✅ ブロックされたらここで止める（元タブをStripeへ飛ばさない）
      if (!payWin) {
        addMessage('system', 'ポップアップがブロックされました。設定で許可してもう一度試してね🙏');
        return;
      }

      setTipLoading(true);

      const text = `💸 チップ ¥${amount} をはずむ。`;
      addMessage('user', text);
      socket.emit('guest.message', { text });

      setTipEffect(true);
      socket.emit('guest.tip', { amount });

      if (tipTimerRef.current) window.clearTimeout(tipTimerRef.current);
      tipTimerRef.current = window.setTimeout(() => setTipEffect(false), 900);

      const res = await fetch('http://localhost:4000/api/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount,
          roomId: roomIdRef.current,
          socketId: socket.id,
        }),
      });

      const data = await res.json();
          if (!res.ok || !data?.url) throw new Error(data?.error || 'failed to create session');

      // ✅ このタブは「チップ決済用ポップアップ」だと印を付ける（同一生成元: about:blank なので書ける）
      try {
        payWin.sessionStorage.setItem('tip_popup', '1');
      } catch {}
      try { payWin.name = 'tip_popup'; } catch {}


          // ✅ ここが効くようになる
          payWin.location.replace(data.url);

        } catch (e) {
          console.error(e);
          if (payWin && !payWin.closed) payWin.close();
          addMessage('system', '決済の開始に失敗しました…');
        } finally {
          setTipLoading(false);
          setTipOpen(false);
        }
      };


  return (
    <div
      className="relative min-h-screen overflow-hidden text-snack-text"
      style={{
        backgroundImage: "url('/assets/session.jpg')",
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
        backgroundColor: '#000', // 念のため
      }}
    >

      {/* ===== UI（既存） ===== */}
      <div className={'relative z-10 flex flex-col min-h-screen overflow-hidden ' + (tipEffect ? 'shadow-neon-pink' : '')}>
        {/* 💸 コインアニメーション */}
        {tipEffect && (
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute bottom-4 left-1/3 w-6 h-6 rounded-full border border-yellow-300 bg-yellow-200/90 animate-coin" />
            <div className="absolute bottom-6 left-1/2 w-5 h-5 rounded-full border border-yellow-300 bg-yellow-200/80 animate-coin delay-150" />
            <div className="absolute bottom-3 left-2/3 w-4 h-4 rounded-full border border-yellow-300 bg-yellow-200/70 animate-coin delay-300" />
          </div>
        )}

        {/* ママの表示エリア */}
        <div className="h-2/5 relative">
          <div className="absolute inset-0 bg-black/10" />
          <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-transparent to-snack-bg/40" />

          <div className="absolute bottom-4 left-4">
            <span className="bg-snack-neon-pink text-white text-xs px-2 py-1 rounded">ON AIR</span>
          </div>
        </div>

        {/* メッセージログ */}
        <div className="flex-grow p-4 overflow-y-auto space-y-4 bg-black/30 border border-white/10 rounded-2xl">
          <div className="text-center text-xs text-gray-500 my-2">—— ママが入店しました ——</div>

          {messages.map((m) => {
            if (m.from === 'system') {
              return (
                <div key={m.id} className="flex w-full justify-center">
                  <span className="text-[13px] text-[#E6E0D8] drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]">
                    {m.text}
                  </span>
                </div>
              );
            }

            const isMama = m.from === 'mama';
            return (
              <div key={m.id} className={`flex w-full ${isMama ? 'justify-start' : 'justify-end'}`}>
                <div
                  className={`bubble-in max-w-[80%] px-4 py-3 rounded-2xl text-[17px] leading-[1.8]
                    ${
                      isMama
                        ? 'bg-black/45 text-[#F4EBDD] drop-shadow-[0_2px_4px_rgba(0,0,0,0.6)] rounded-tl-none'
                        : 'ml-auto bg-[#f1e6d6] text-[#2b1c12] shadow-[0_4px_14px_rgba(0,0,0,0.25)] rounded-tr-none'
                    }`}
                >
                  {m.text}
                </div>
              </div>
            );
          })}
        </div>

        {/* 入力エリア */}
        <footer className="p-4 bg-snack-bg border-t border-snack-brown">
          {/* クイックアクション */}
          <div className="flex gap-2 mb-3">
            <button
              type="button"
              onClick={handleCheers}
              className="flex-1 bg-yellow-900/40 border border-yellow-600 text-yellow-200 py-2 rounded-full text-sm"
            >
              🍸 乾杯
            </button>
            <button
              type="button"
              onClick={handleConsult}
              className="flex-1 bg-snack-neon-blue/20 border border-snack-neon-blue text-snack-neon-blue py-2 rounded-full text-sm"
            >
              💬 相談
            </button>
            <button
              type="button"
              onClick={handleTip}
              className="flex-1 bg-snack-neon-pink/10 border border-snack-neon-pink text-snack-neon-pink py-2 rounded-full text-sm"
            >
              💸 チップ
            </button>
          </div>

          {/* もう帰るボタン */}
          <div className="flex justify-end mb-2">
            <button
              type="button"
              onClick={() => {
                if (leaveSoundRef.current) {
                  try {
                    leaveSoundRef.current.currentTime = 0;
                    leaveSoundRef.current.play();
                  } catch (e) {
                    console.warn('leave sound play error', e);
                  }
                }
                window.setTimeout(() => onLeave(), 900);
              }}
              className="px-3 py-1 rounded-full border border-gray-600 text-[11px] text-gray-300 hover:bg-gray-800 transition-colors"
            >
              もう帰る
            </button>
          </div>

          {/* 入力 + 送信 */}
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="メッセージを入力..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              className="flex-grow bg-black/50 border border-snack-brown rounded-full px-4 py-2 text-sm focus:outline-none focus:border-snack-neon-pink"
            />
            <button
              type="button"
              onClick={handleSend}
              className="bg-snack-neon-pink p-2 rounded-full w-10 h-10 flex items-center justify-center shadow-neon-pink active:scale-95 transition-transform"
            >
              ▶
            </button>
          </div>
        </footer>
      </div>

      {tipOpen && (
        <div className="absolute inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#1c1715]/95 p-4 shadow-xl">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm text-snack-text">チップの金額を選んでね</div>
              <button
                type="button"
                onClick={() => (tipLoading ? null : setTipOpen(false))}
                className="text-xs text-gray-300 px-2 py-1 rounded-full border border-gray-600"
              >
                閉じる
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {TIP_OPTIONS.map((a) => (
                <button
                  key={a}
                  type="button"
                  disabled={tipLoading}
                  onClick={() => startTipPayment(a)}
                  className="py-3 rounded-xl border border-snack-neon-pink/40 bg-snack-neon-pink/10 text-snack-neon-pink text-sm active:scale-95 transition-transform disabled:opacity-60"
                >
                  ¥{a}
                </button>
              ))}
            </div>

            <div className="mt-3 text-[11px] text-gray-400">
              ※ お支払い画面（PayPay等）に移動します
            </div>
          </div>
        </div>
      )}
      {showCloseButton && (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-4 pointer-events-none">
          <button
            type="button"
            onClick={() => window.close()}
            className="pointer-events-auto w-full max-w-md py-3 rounded-2xl bg-black/70 border border-white/15 text-[#F4EBDD]"
          >
            この画面を閉じる
          </button>
        </div>
      )}

      {/* ✅ 背景のネオンを「上に薄く」かける（必ず見える） */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          zIndex: 0,
          background:
            'linear-gradient(to bottom, rgba(60,30,20,0.55), rgba(10,8,10,0.85)),' +
            'radial-gradient(circle at 20% 8%, rgba(255,120,120,0.18), transparent 42%),' +
            'radial-gradient(circle at 80% 28%, rgba(120,180,255,0.12), transparent 45%)',
          mixBlendMode: 'screen',
        }}
      />

    </div>
  );
};

export default SessionRoom;
