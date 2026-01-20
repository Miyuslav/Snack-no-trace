// frontend/src/App.jsx
import React, { useState, useEffect, useRef } from 'react';
import TopSelection from './components/TopSelection';
import WaitingRoom from './components/WaitingRoom';
import SessionRoom from './components/SessionRoom';
import MamaConsole from './components/MamaConsole';
import { socket } from './socket';

const ZOOM_URL =
  import.meta.env.VITE_ZOOM_URL ||
  'https://us05web.zoom.us/j/86469761078?pwd=1tbixjqfTT4dzYRdHwHcv4GVAb84M0.1';

const VirtualSnackApp = () => {
  const params = new URLSearchParams(window.location.search);
  const role = params.get('role');

  // ===== ママ用画面 =====
  if (role === 'mama') {
    return <MamaConsole />;
  }

  // ===== お客さん用画面 =====
  const [step, setStep] = useState('TOP'); // TOP, WAITING, SESSION, DONE
  const [sessionInfo, setSessionInfo] = useState({ mood: '', mode: '' });

  // 入店効果音（ゲスト側）
  const enterSoundRef = useRef(null);

  // 効果音の初期化（マウント時に一度だけ）
  useEffect(() => {
    const a = new Audio('/door.mp3');
    a.preload = 'auto';
    a.volume = 0.28;          // 追加：音量
    enterSoundRef.current = a;
  }, []);
;

  // サーバーから「セッション開始」「セッション終了」を受け取る
  useEffect(() => {
    const handleStarted = () => {
      if (enterSoundRef.current) {
        try {
          enterSoundRef.current.currentTime = 0;
          enterSoundRef.current.play();
        } catch (e) {
          console.warn('enter sound play error (guest)', e);
        }
      }
      setStep('SESSION');
    };

    const handleEnded = () => {
      setStep('DONE');
    };

    socket.on('session.started', handleStarted);
    socket.on('session.ended', handleEnded);

    return () => {
      socket.off('session.started', handleStarted);
      socket.off('session.ended', handleEnded);
    };
  }, []);

  // 扉を開ける（待機キューに登録）
  const handleEnter = (mood, mode) => {
    setSessionInfo({ mood, mode });
    setStep('WAITING');

    socket.emit('guest.register', { mood, mode });
  };

  // ゲスト側の「もう帰る」
  const handleLeave = () => {
    try {
      socket.emit('guest.leave');
    } catch (e) {
      console.warn('guest.leave emit error', e);
    }
    setStep('DONE');
  };

  // ===== DONE画面 =====
  if (step === 'DONE') {
    return (
      <div className="min-h-screen bg-snack-bg text-snack-text font-snack relative overflow-hidden flex flex-col items-center justify-center px-6">
        {/* ノイズ */}
        <div className="pointer-events-none absolute inset-0 bg-noise opacity-[0.06] mix-blend-overlay" />
        {/* 上下の影 */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/20 to-black/40" />

        <div className="max-w-md w-full bg-snack-panel/70 border border-snack-panel rounded-xl p-6 shadow-lg">
          <p className="mb-5 text-sm text-snack-text-dim leading-relaxed italic">
            貴方のモヤモヤは全て蒸発しました。<br />
            またのご来店を心よりお待ち申し上げております。🍸
          </p>

          <button
            type="button"
            className="
              w-full px-4 py-3 rounded-full
              border border-snack-neon-pink/70
              text-snack-neon-pink
              text-sm
              hover:opacity-90
              transition
            "
            onClick={() => setStep('TOP')}
          >
            トップに戻る
          </button>
        </div>
      </div>
    );
  }

  // ===== 通常フロー =====
  return (
    <div className="min-h-screen bg-snack-bg text-snack-text font-snack text-[15px] md:text-base relative overflow-hidden">
      {/* ノイズ（全画面共通） */}
      <div className="pointer-events-none absolute inset-0 bg-noise opacity-[0.06] mix-blend-overlay" />
      {/* 上下の影（全画面共通） */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/15 to-black/35" />

      {/* 画面枠（スマホ縦想定） */}
      <div className="relative max-w-md mx-auto min-h-screen border-x border-snack-panel">
        {step === 'TOP' && <TopSelection onEnter={handleEnter} />}

        {step === 'WAITING' && (
          <WaitingRoom
            sessionInfo={sessionInfo}
            onCancel={handleLeave}
          />
        )}

        {step === 'SESSION' && (
          <SessionRoom
            sessionInfo={sessionInfo}
            onLeave={handleLeave}
          />
        )}
      </div>
    </div>
  );
};

export default VirtualSnackApp;
