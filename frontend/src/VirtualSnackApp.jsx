import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import TopSelection from './components/TopSelection';
import WaitingRoom from './components/WaitingRoom';
import SessionRoom from './components/SessionRoom';
import MamaConsole from './components/MamaConsole';
import { socket } from './socket';
import { createUUID } from "./utils/uuid";

const VirtualSnackApp = () => {
  const params = new URLSearchParams(window.location.search);
  const role = params.get('role');

  // ===== ママ用 =====
  if (role === 'mama') {
    return <MamaConsole />;
  }

  // ===== ゲスト用 =====
  const [step, setStep] = useState('TOP');
  const [sessionInfo, setSessionInfo] = useState({ mood: '', mode: '' });

  // ✅ roomId をここで確定（WAITINGでも使う）
  const [roomId] = useState(() => {
    const key = 'snack_room_id';
    const existing = window.localStorage.getItem(key);
    const rid = existing || `room_${createUUID()}`;
    window.localStorage.setItem(key, rid);
    return rid;
  });

  const enterSoundRef = useRef(null);

  // ===== 入店音 =====
  useEffect(() => {
    const a = new Audio('/door.mp3');
    a.volume = 0.28;
    enterSoundRef.current = a;
  }, []);

  // ✅ socket 接続／再接続のたびに join_room（WAITINGでも必須）
  useEffect(() => {
    const rejoin = () => {
      socket.emit('join_room', { roomId });
      console.log('[rejoin] join_room', roomId);
    };

    socket.on('connect', rejoin);
    rejoin(); // 初回も必ず送る

    return () => socket.off('connect', rejoin);
  }, [roomId]);

  // ===== セッション開始／終了 =====
  useEffect(() => {
    const onStarted = (payload) => {
      console.log('[session.started]', payload);
      enterSoundRef.current?.play().catch(() => {});
      setStep('SESSION');
    };

    const onEnded = () => {
      console.log('[session.ended]');
      setStep('DONE');
    };

    socket.on('session.started', onStarted);
    socket.on('session.ended', onEnded);

    return () => {
      socket.off('session.started', onStarted);
      socket.off('session.ended', onEnded);
    };
  }, []);

  // ===== 入店 =====
  const handleEnter = (mood, mode) => {
    console.log('[APP] handleEnter called', { mood, mode, t: Date.now() });
    setSessionInfo({ mood, mode });
    setStep('WAITING');

    // 音声アンロック
    const a = enterSoundRef.current;
    if (a) {
      try {
        a.muted = true;
        a.play()
          .then(() => {
            a.pause();
            a.currentTime = 0;
            a.muted = false;
          })
          .catch(() => {});
      } catch {}
    }

    socket.emit('guest.register', { mood, mode });
  };

  const handleLeave = () => {
    socket.emit('guest.leave');
    setStep('DONE');
  };

  // ===== 完了画面 =====
  if (step === 'DONE') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-snack-bg text-snack-text">
        <button onClick={() => setStep('TOP')}>トップに戻る</button>
      </div>
    );
  }

  // ===== 通常UI =====
  return (
    <div className="min-h-screen bg-snack-bg text-snack-text font-snack relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-noise opacity-[0.06] mix-blend-overlay" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/15 to-black/35" />

      {/* 📱 スマホ幅でも崩れない安全枠 */}
      <div className="relative max-w-md mx-auto min-h-screen border-x border-snack-panel">
        {step === 'TOP' && <TopSelection onEnter={handleEnter} />}
        {step === 'WAITING' && (
          <WaitingRoom sessionInfo={sessionInfo} onCancel={handleLeave} />
        )}
        {step === 'SESSION' && (
          <SessionRoom
            sessionInfo={sessionInfo}
            roomId={roomId}
            onLeave={handleLeave}
          />
        )}
      </div>
    </div>
  );
};

export default VirtualSnackApp;
