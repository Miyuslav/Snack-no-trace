import React, { useState, useEffect, useRef } from 'react';
import TopSelection from './components/TopSelection';
import WaitingRoom from './components/WaitingRoom';
import SessionRoom from './components/SessionRoom';
import MamaConsole from './components/MamaConsole';
import { getSocket } from "./socket";
import { createUUID } from './utils/uuid';
import { useLocation, useNavigate } from "react-router-dom";


const VirtualSnackApp = () => {
  const location = useLocation();
  const navigate = useNavigate(); // ★ これを追加

  // ★ /mama ではゲストアプリを完全停止
  if (location.pathname.startsWith("/mama")) {
    return null;
  }

  // ✅ ゲスト用 socket はここで1回だけ作る
  const socketRef = useRef(null);
  if (!socketRef.current) {
    socketRef.current = getSocket("guest");
  }
  const socket = socketRef.current;

  const [sessionInfo, setSessionInfo] = useState({ mood: "", mode: "" });


  // ✅ roomId固定
  const [roomId] = useState(() => {
    const key = 'snack_room_id';
    const existing = window.localStorage.getItem(key);
    const rid = existing || `room_${createUUID()}`;
    window.localStorage.setItem(key, rid);
    return rid;
  });

  const enterSoundRef = useRef(null);

  useEffect(() => {
    const a = new Audio('/door.mp3');
    a.volume = 0.28;
    enterSoundRef.current = a;
  }, []);

  // ✅ 接続/再接続のたび join_room（ルート無関係で常に）
  useEffect(() => {
    const rejoin = () => {
      socket.emit('join_room', { roomId });
      console.log('[rejoin] join_room', roomId);
    };

    socket.on('connect', rejoin);
    rejoin();

    return () => socket.off('connect', rejoin);
  }, [roomId]);

  // ✅ session started/ended → URL遷移
  useEffect(() => {
    const onStarted = (payload) => {
      console.log('[session.started]', payload);
      enterSoundRef.current?.play().catch(() => {});
      navigate('/session', { replace: true });
    };

    const onEnded = () => {
      console.log('[session.ended]');
    };

    socket.on('session.started', onStarted);
    socket.on('session.ended', onEnded);

    return () => {
      socket.off('session.started', onStarted);
      socket.off('session.ended', onEnded);
    };
  }, [navigate]);

  const handleEnter = (mood, mode) => {
    console.log('[APP] handleEnter called', { mood, mode, t: Date.now() });
    setSessionInfo({ mood, mode });

    // ✅ URLをWAITINGへ
    navigate('/waiting');

    // 音声アンロック（iOS対策）
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
    navigate('/done', { replace: true });
  };

  // ✅ ルートで表示を切り替える
  const path = location.pathname;

  if (path === '/done') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-snack-bg text-snack-text">
        <button onClick={() => navigate('/', { replace: true })}>トップに戻る</button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-snack-bg text-snack-text font-snack relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-noise opacity-[0.06] mix-blend-overlay" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/15 to-black/35" />

      <div className="relative max-w-md mx-auto min-h-screen border-x border-snack-panel">
        {path === '/' && <TopSelection onEnter={handleEnter} />}
        {path === '/waiting' && (
          <WaitingRoom sessionInfo={sessionInfo} onCancel={handleLeave} />
        )}
        {path === '/session' && (
          <SessionRoom sessionInfo={sessionInfo} roomId={roomId} onLeave={handleLeave} />
        )}
      </div>
    </div>
  );
};

export default VirtualSnackApp;
