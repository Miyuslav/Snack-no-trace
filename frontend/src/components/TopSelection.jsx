import React, { useState, useRef, useEffect } from 'react';

const TopSelection = ({ onEnter }) => {
  const [mood, setMood] = useState('relax');
  const [mode, setMode] = useState('text'); // text / chat
  const [isPuffing, setIsPuffing] = useState(false);

  const evapSoundRef = useRef(null);
  const timeoutsRef = useRef([]);
  const ZOOM_URL =
    import.meta.env.VITE_ZOOM_URL ||
    'https://us05web.zoom.us/j/86469761078?pwd=1tbixjqfTT4dzYRdHwHcv4GVAb84M0.1';


  useEffect(() => {
    return () => {
      timeoutsRef.current.forEach((t) => clearTimeout(t));
      timeoutsRef.current = [];
    };
  }, []);

  const playEvap = () => {
    // ブラウザ以外/一部環境で Audio が無いと落ちるのでガード
    if (typeof window === 'undefined' || typeof Audio === 'undefined') return;

    try {
      if (!evapSoundRef.current) {
        const a = new Audio('/cat.mp3');
        a.preload = 'auto';
        a.volume = 0.32;
        evapSoundRef.current = a;
      }

      const a = evapSoundRef.current;
      a.currentTime = 0;
      a.play().catch(() => {}); // iOS等で拒否されても落ちない
    } catch (e) {
      console.warn('evap sound error', e);
    }
  };

  const handleEvaporate = () => {
    if (isPuffing) return; // 連打で事故るの防止（任意）
     // ✅ クリック直後にZoomを開く（ポップアップブロック回避）
     if (mode === 'chat' && ZOOM_URL) {
       try {
         window.open(ZOOM_URL, '_blank', 'noopener,noreferrer');
       } catch (e) {
         console.warn('failed to open zoom url', e);
       }
     }

    playEvap();

    setIsPuffing(true);
    timeoutsRef.current.push(setTimeout(() => setIsPuffing(false), 1600));
    timeoutsRef.current.push(setTimeout(() => onEnter(mood, mode), 1000));
  };

  return (
    <div className="p-6 flex flex-col h-full animate-fadeIn bg-snack-bg text-snack-text">
      <header className="text-center py-8">
        <div className="inline-block relative">
          <img
            src="/assets/logo.png"
            alt="スナック蒸発"
            className="w-[400px] mx-auto rounded-md drop-shadow-[0_0_12px_rgba(255,90,120,.35)]"
          />
          <div className="absolute inset-0 rounded-md blur-xl opacity-40 bg-snack-neon-pink/30 -z-10" />
        </div>

        <p className="mt-4 text-[13px] text-snack-text-dim tracking-[0.3em] uppercase italic">
          VIRTUAL SNACK – NO TRACE
        </p>
      </header>

      <main className="flex-grow space-y-8">
        <section>
          <h2 className="text-sm mb-6 text-snack-text-dim border-b border-snack-panel pb-1">
            今日の気分
          </h2>

          <div className="grid grid-cols-1 gap-3">
            {[
              { id: 'relax', label: ' 癒されたい', color: 'bg-[#3a1f2a]/60 text-[#f0c9d5]' },
              { id: 'listen', label: ' 話を聞いてほしい', color: 'bg-[#1f2d3a]/60 text-[#c9def0]' },
              { id: 'advise', label: ' 悩みを相談したい', color: 'bg-[#1f3a2b]/60 text-[#cfead8]' },
            ].map((m) => (
              <button
                key={m.id}
                onClick={() => setMood(m.id)}
                className={`
                  p-4 rounded-xl text-left font-bold transition-all
                  ${m.color}
                  ${mood === m.id ? 'ring-2 ring-snack-neon-pink scale-[1.02]' : 'opacity-70 hover:opacity-90'}
                `}
              >
                {m.label}
              </button>
            ))}
          </div>
        </section>

        <section className="bg-snack-panel/70 p-4 rounded-lg border border-snack-panel">
          <h2 className="text-sm mb-6 text-snack-text">対話モード</h2>

          <div className="flex bg-snack-bg-soft/80 p-1 rounded-full mb-3">
            <button
              className={`flex-1 py-2 rounded-full text-sm transition ${
                mode === 'text'
                  ? 'bg-snack-neon-blue text-snack-bg font-bold shadow-neon-blue'
                  : 'text-snack-text-dim'
              }`}
              onClick={() => setMode('text')}
            >
              テキストのみ
            </button>

            <button
              className={`flex-1 py-2 rounded-full text-sm transition ${
                mode === 'chat'
                  ? 'bg-snack-neon-blue text-snack-bg font-bold shadow-neon-blue'
                  : 'text-snack-text-dim'
              }`}
              onClick={() => setMode('chat')}
            >
              映像付きチャット
            </button>
          </div>

          <p className="text-[11px] text-snack-text-dim leading-relaxed">
            ・<span className="font-semibold text-snack-neon-blue">テキストのみ</span>：このアプリ内の文字だけで、しっぽりお話しします。<br />
            ・<span className="font-semibold text-snack-neon-blue">映像付きチャット</span>：Zoom を使ったビデオ通話です。待機画面にリンクが表示されます。
          </p>
        </section>

        <button
          type="button"
          onClick={handleEvaporate}
          className={`evaporate-btn ${isPuffing ? 'is-pop' : ''} relative overflow-hidden
            w-full py-5 mt-4 rounded-2xl
            text-xl font-bold text-white
            bg-snack-neon-pink/85
            border border-white/25
            shadow-[0_0_12px_rgba(255,90,120,0.45),0_0_26px_rgba(255,90,120,0.30)]
            transition-all duration-500
            hover:bg-snack-neon-pink/95
            hover:-translate-y-[1px]
            hover:shadow-[0_0_22px_rgba(255,255,255,0.70),0_0_56px_rgba(255,90,120,0.75),0_0_92px_rgba(255,90,120,0.45)]
            active:scale-[0.97]
          `}
        >
          <span className="evaporate-flash" />
          <span className="evaporate-ring" />
          <span className="relative z-10 drop-shadow-[0_1px_0_rgba(0,0,0,0.65)]">蒸発する</span>
        </button>
      </main>
    </div>
  );
};

export default TopSelection;
