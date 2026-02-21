import React, { useState, useRef, useEffect } from 'react';

const TopSelection = ({ onEnter }) => {
  const [mood, setMood] = useState('relax');
  const [mode, setMode] = useState('text');
  const [isPuffing, setIsPuffing] = useState(false);

  const evapSoundRef = useRef(null);
  const timeoutsRef = useRef([]);

  useEffect(() => {
    return () => {
      timeoutsRef.current.forEach((t) => clearTimeout(t));
      timeoutsRef.current = [];
    };
  }, []);

  const playEvap = () => {
    if (typeof window === 'undefined' || typeof Audio === 'undefined') return;
    try {
      if (!evapSoundRef.current) {
        const a = new Audio('/open.mp3');
        a.preload = 'auto';
        a.volume = 0.32;
        evapSoundRef.current = a;
      }
      const a = evapSoundRef.current;
      a.currentTime = 0;
      a.play().catch(() => {});
    } catch (e) {
      console.warn('evap sound error', e);
    }
  };

  const handleEvaporate = () => {
    if (isPuffing) return;
    onEnter?.(mood, mode);
    playEvap();
    setIsPuffing(true);
    timeoutsRef.current.push(setTimeout(() => setIsPuffing(false), 1600));
  };

  return (
    /* 画面全体のコンテナ：100dvhで固定 */
    <div className="relative h-[100dvh] w-full overflow-hidden text-snack-text bg-[#120d12]">

      {/* --- 背景レイヤー --- */}
      <div
        className="absolute inset-0 z-0"
        style={{
          backgroundImage: "url('/assets/bg-front.webp')",
          backgroundSize: 'contain',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
        }}
      />
      <div className="absolute inset-0 z-[1] bg-gradient-to-b from-black/35 via-black/20 to-black/70" />
      <div className="absolute -top-24 -left-24 w-96 h-96 rounded-full blur-[140px] bg-snack-neon-pink/20 z-[1]" />
      <div className="absolute top-1/3 -right-28 w-96 h-96 rounded-full blur-[140px] bg-snack-neon-blue/15 z-[1]" />

      {/* --- UIレイヤー --- */}
      <div className="relative z-10 h-full flex flex-col px-4 animate-fadeIn">

        {/* 1. ロゴ：上部にしっかり余白を確保 */}
        <header className="shrink-0 pt-12 pb-4 text-center">
          <div className="inline-flex flex-col items-center gap-3">
            <div className="relative">
              <img
                src="/assets/logo.png"
                alt="スナック蒸発"
                className="w-[min(220px,65vw)] drop-shadow-[0_0_12px_rgba(255,90,120,.35)]"
              />
            </div>
            <p className="text-[10px] text-snack-text-dim tracking-[0.2em] uppercase italic">
              VIRTUAL SNACK – NO TRACE
            </p>
          </div>
        </header>

        {/* 2. メイン：中央配置（justify-center）で、画面サイズに合わせて伸縮 */}
        <main className="flex-1 flex flex-col justify-center min-h-0 overflow-hidden w-full px-5 max-w-lg mx-auto">

          <section>
            <h2 className="text-xs mb-2 text-snack-text-dim border-b border-snack-panel pb-1">今日の気分</h2>
                        <div className="grid grid-cols-1 gap-2">
              {[
                { id: 'relax', label: ' 癒されたい', color: 'bg-[#3a1f2a]/60 text-[#f0c9d5]' },
                { id: 'listen', label: ' 話を聞いてほしい', color: 'bg-[#1f2d3a]/60 text-[#c9def0]' },
                { id: 'advise', label: ' 悩みを相談したい', color: 'bg-[#1f3a2b]/60 text-[#cfead8]' },
              ].map((m) => (
                <button
                  key={m.id}
                  onClick={() => setMood(m.id)}
                  className={`py-3 px-4 rounded-lg text-left font-bold transition-all text-sm
                    ${m.color}
                    ${mood === m.id ? 'ring-2 ring-snack-neon-pink scale-[1.02]' : 'opacity-70 hover:opacity-100'}
                  `}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </section>

          <section className="bg-snack-panel/70 p-4 rounded-xl border border-snack-panel">
            <h2 className="text-xs mb-4 text-snack-text">対話モード</h2>
            <div className="flex bg-snack-bg-soft/80 p-1 rounded-full mb-4">
              <button
                className={`flex-1 py-3 rounded-full text-xs font-bold transition ${
                  mode === 'text' ? 'bg-gradient-to-r from-snack-neon-pink to-[#a078ffcc] text-snack-bg shadow-neon-pinkviolet' : 'text-snack-text-dim'
                }`}
                onClick={() => setMode('text')}
              >
                テキストのみ
              </button>
              <button
                className={`flex-1 py-3 rounded-full text-xs font-bold transition ${
                  mode === 'voice' ? 'bg-gradient-to-r from-snack-neon-pink to-[#a078ffcc] text-snack-bg shadow-neon-pinkviolet' : 'text-snack-text-dim'
                }`}
                onClick={() => setMode('voice')}
              >
                音声のみ
              </button>
            </div>
            <p className="text-[12px] text-snack-text-dim leading-relaxed">
              ・<span className="text-snack-neon-blue font-semibold">テキスト</span>：文字だけで、しっぽりお話しします。<br />
              ・<span className="text-snack-neon-blue font-semibold">音声</span>：声だけで、落ち着いてお話しします。
            </p>
          </section>
        </main>

        {/* 3. ボタン：最下部に固定（shrink-0で潰さない） */}
         <footer className="shrink-0 relative h-32 flex flex-col justify-end pb-[max(24px,env(safe-area-inset-bottom))]">
                   <button
                     type="button"
                     onClick={handleEvaporate}
                     className={`evaporate-btn ${isPuffing ? 'is-pop' : ''}
                       relative w-full
                       pt-3.5 pb-2.5 rounded-2xl
                       text-lg font-bold text-white
                       bg-snack-neon-pink/80 backdrop-blur-md
                       border border-white/30
                       shadow-[0_8px_32px_rgba(255,90,120,0.5),0_0_15px_rgba(255,90,120,0.3)]
                       transition-all active:scale-[0.96]
                     `}
                   >
                     <span className="evaporate-flash" />
                     <span className="evaporate-ring" />
                     <span className="relative z-10 flex flex-col items-center leading-none">
                       <span className="drop-shadow-[0_1px_0_rgba(0,0,0,0.65)]">蒸発する</span>
                       <span className="mt-1 text-[11px] font-semibold tracking-[0.12em] text-white/90">店に入る</span>
                     </span>
                   </button>
                 </footer>
               </div>
    </div>
  );
};

export default TopSelection;
