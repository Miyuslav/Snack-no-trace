import React, { useState, useEffect, useRef } from 'react';
import TopSelection from './components/TopSelection';
import WaitingRoom from './components/WaitingRoom';
import SessionRoom from './components/SessionRoom';
import MamaConsole from './components/MamaConsole';
import { socket } from './socket';

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
  const enterSoundRef = useRef(null);

  useEffect(() => {
    const a = new Audio('/assets/door.mp3');
    a.volume = 0.28;
    enterSoundRef.current = a;
  }, []);

  useEffect(() => {
    const onStarted = () => {
      enterSoundRef.current?.play().catch(() => {});
      setStep('SESSION');
    };
    const onEnded = () => setStep('DONE');

    socket.on('session.started', onStarted);
    socket.on('session.ended', onEnded);

    return () => {
      socket.off('session.started', onStarted);
      socket.off('session.ended', onEnded);
    };
  }, []);

  const handleEnter = (mood, mode) => {
    setSessionInfo({ mood, mode });
    setStep('WAITING');
    socket.emit('guest.register', { mood, mode });
  };

  const handleLeave = () => {
    socket.emit('guest.leave');
    setStep('DONE');
  };

  if (step === 'DONE') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-snack-bg text-snack-text">
        <button onClick={() => setStep('TOP')}>トップに戻る</button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-snack-bg text-snack-text font-snack text-[15px] md:text-base relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-noise opacity-[0.06] mix-blend-overlay" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/15 to-black/35" />

      {/* これが無いと崩れる */}
      <div className="relative max-w-md mx-auto min-h-screen border-x border-snack-panel">
        {step === 'TOP' && <TopSelection onEnter={handleEnter} />}
        {step === 'WAITING' && <WaitingRoom sessionInfo={sessionInfo} onCancel={handleLeave} />}
        {step === 'SESSION' && <SessionRoom sessionInfo={sessionInfo} onLeave={handleLeave} />}
        {/* DONE画面もここに戻す */}
      </div>
    </div>
  );

};

export default VirtualSnackApp;
