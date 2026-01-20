import React, { useState, useEffect, useRef } from 'react';
import { socket } from '../socket';

const moodLabelMap = {
  relax: '🌸 癒されたい',
  listen: '💬 話を聞いてほしい',
  advise: '🤔 悩みを相談したい'
};

const modeLabelMap = {
  text: 'テキストのみ',
  chat: 'チャット'
};

const MamaConsole = () => {
  const [queue, setQueue] = useState([]);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [currentGuest, setCurrentGuest] = useState(null);
  const [remainingMs, setRemainingMs] = useState(null);
  const [tipFlash, setTipFlash] = useState(false); // 💸 チップ演出用
  const tipSoundRef = useRef(null);                // 💸 チップ音用

  const addMessage = (from, text) => {
    setMessages((prev) => [
      ...prev,
      { id: prev.length + 1, from, text }
    ]);
  };

  // 音声の初期化（ママ側だけ読み込んでおく）
    useEffect(() => {
      tipSoundRef.current = new Audio('/Cash.mp3');
    }, []);

  useEffect(() => {
    // 待機キューの更新
    const onQueueUpdate = (list) => {
      setQueue(list);
    };

    const onNotify = () => {
      addMessage('system', '新しいお客さんが入店しました。');
    };

    const onChatMessage = ({ from, text }) => {
      addMessage(from === 'guest' ? 'guest' : 'mama', text);
    };

    const onSessionStarted = (payload) => {
      setCurrentGuest({
        socketId: payload.guestSocketId,
        mood: payload.mood,
        mode: payload.mode
      });
      setMessages([]);
      setRemainingMs(payload.maxMs || null);
      addMessage('system', 'セッションが開始しました。（最大10分）');
    };

    const onSessionEnded = ({ reason }) => {
      addMessage('system', `セッションが終了しました。（理由: ${reason}）`);
      setCurrentGuest(null);
      setRemainingMs(null);
    };

    // ⏰ 終了1分前アラート
    const onWarning = () => {
      addMessage(
        'system',
        '⏰ お客さんとのセッションはあと1分で終了します。'
      );
    };

    // 💸 チップ通知
    const onGuestTip = () => {
      setTipFlash(true);
      addMessage('system', '💸 お客さんからチップが届きました。');
      // 音を鳴らす
           if (tipSoundRef.current) {
             try {
               tipSoundRef.current.currentTime = 0;
     　        tipSoundRef.current.play();
             } catch (e) {
               console.warn('tip sound play error', e);
             }
           }
      setTimeout(() => setTipFlash(false), 900);
    };

    socket.on('queue.update', onQueueUpdate);
    socket.on('mama.notify', onNotify);
    socket.on('chat.message', onChatMessage);
    socket.on('session.started', onSessionStarted);
    socket.on('session.ended', onSessionEnded);
    socket.on('session.warning', onWarning);
    socket.on('guest.tip', onGuestTip);

    return () => {
      socket.off('queue.update', onQueueUpdate);
      socket.off('mama.notify', onNotify);
      socket.off('chat.message', onChatMessage);
      socket.off('session.started', onSessionStarted);
      socket.off('session.ended', onSessionEnded);
      socket.off('session.warning', onWarning);
      socket.off('guest.tip', onGuestTip);
    };
  }, []);

  // 残り時間の簡易カウントダウン（クライアント側：約でOK）
  useEffect(() => {
    if (!remainingMs) return;
    const timer = setInterval(() => {
      setRemainingMs((prev) => (prev ? Math.max(prev - 1000, 0) : null));
    }, 1000);
    return () => clearInterval(timer);
  }, [remainingMs]);

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    addMessage('mama', trimmed);
    setInput('');
    socket.emit('mama.message', { text: trimmed });
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSend();
    }
  };

  const handleAccept = (guestSocketId) => {
    socket.emit('mama.acceptGuest', { guestSocketId });
  };

  const handleEndSession = () => {
    socket.emit('mama.endSession');
  };

  const minutes = remainingMs != null ? Math.floor(remainingMs / 60000) : null;
  const seconds = remainingMs != null ? Math.floor((remainingMs % 60000) / 1000) : null;

  return (
    <div className="min-h-screen bg-snack-bg text-snack-text flex flex-col max-w-3xl mx-auto">
      <header
        className={
          'p-4 border-b border-snack-brown flex justify-between items-center ' +
          (tipFlash ? 'shadow-neon-pink' : '')
        }
      >
        <div>
          <h1 className="text-lg font-bold">ママ用コンソール</h1>
          <p className="text-xs text-gray-400">
            Virtual Snack / 待機リスト & チャット
          </p>
        </div>
        <span className="text-xs bg-snack-neon-pink text-black px-2 py-1 rounded-full">
          ONLINE
        </span>
      </header>

      {/* 待機リスト */}
      <section className="p-4 border-b border-snack-brown text-sm bg-snack-brown/20">
        <h2 className="text-xs text-gray-300 mb-2">待機中のお客さん</h2>
        {queue.length === 0 ? (
          <p className="text-gray-500 text-xs">
            現在待機中のお客さんはいません。
          </p>
        ) : (
          <ul className="space-y-2">
            {queue.map((g, index) => (
              <li
                key={g.socketId}
                className="flex items-center justify-between bg-black/30 px-3 py-2 rounded-lg"
              >
                <div className="text-xs">
                  <div className="font-semibold">
                    #{index + 1}{' '}
                    {moodLabelMap[g.mood] ?? '（気分未設定）'}
                  </div>
                  <div className="text-gray-400">
                    モード: {modeLabelMap[g.mode] ?? '未設定'}
                  </div>
                </div>
                <button
                  type="button"
                  className="px-3 py-1 rounded-full text-xs bg-snack-neon-blue text-black font-semibold"
                  onClick={() => handleAccept(g.socketId)}
                >
                  入店させる
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* セッション情報 + チャット */}
      <main className="flex-1 flex flex-col">
        <div className="p-4 border-b border-snack-brown text-xs bg-black/40 flex justify-between items-center">
          <div>
            {currentGuest ? (
              <>
                <span className="font-semibold">会話中のゲスト</span>{' '}
                <span className="text-gray-300">
                  {moodLabelMap[currentGuest.mood]} /{' '}
                  {modeLabelMap[currentGuest.mode]}
                </span>
              </>
            ) : (
              <span className="text-gray-500">
                まだ誰とも会話していません。
              </span>
            )}
          </div>
          {remainingMs != null && (
            <div className="text-snack-neon-pink font-mono">
              残り {minutes}:{seconds.toString().padStart(2, '0')}
            </div>
          )}
        </div>

        <div className="flex-1 p-4 overflow-y-auto space-y-3 bg-snack-bg">
          {messages.map((m) => (
            <div
              key={m.id}
              className={`flex ${
                m.from === 'guest'
                  ? 'justify-start'
                  : m.from === 'mama'
                  ? 'justify-end'
                  : 'justify-center'
              }`}
            >
              {m.from === 'system' ? (
                <span className="text-xs text-gray-500">{m.text}</span>
              ) : (
                <div
                  className={`max-w-[80%] p-3 rounded-2xl text-sm leading-relaxed ${
                    m.from === 'guest'
                      ? 'bg-snack-brown text-snack-text rounded-tl-none'
                      : 'bg-snack-neon-blue text-black rounded-tr-none'
                  }`}
                >
                  {m.text}
                </div>
              )}
            </div>
          ))}
        </div>

        <footer className="p-4 border-t border-snack-brown bg-snack-bg">
          <div className="flex gap-2 mb-2">
            <button
              type="button"
              onClick={handleEndSession}
              disabled={!currentGuest}
              className="px-3 py-1 rounded-full text-xs border border-gray-500 text-gray-300 disabled:opacity-40"
            >
              セッション終了
            </button>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="お客さんへのメッセージを入力..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              className="flex-grow bg-black/50 border border-snack-brown rounded-full px-4 py-2 text-sm focus:outline-none focus:border-snack-neon-pink"
              disabled={!currentGuest}
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={!currentGuest}
              className="bg-snack-neon-pink p-2 rounded-full w-10 h-10 flex items-center justify-center shadow-neon-pink active:scale-95 transition-transform disabled:opacity-40"
            >
              ▶
            </button>
          </div>
        </footer>
      </main>
    </div>
  );
};

export default MamaConsole;
