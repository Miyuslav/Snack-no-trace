import React, { useState, useRef, useEffect } from 'react';

const TopSelection = ({ onEnter }) => {
  const [mood, setMood] = useState('relax');
  const [mode, setMode] = useState('text'); // text / voice
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
        const a = new Audio('/cat.mp3');
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

    console.log('[TOP] enter clicked', { mood, mode });

    // ✅ 先に必ず入店（WAITINGへ）
    onEnter(mood, mode);

    // 演出は後回しでOK
    playEvap();
    setIsPuffing(true);
    timeoutsRef.current.push(setTimeout(() => setIsPuffing(false), 1600));

    // ✅ 音声のみは「外部URLを開かない」前提（実装は後でOK）
  };

  return (
    <div
      className="
        relative h-[100dvh] min-h-[100svh] overflow-hidden text-snack-text
        flex flex-col
        pb-[max(20px,env(safe-area-inset-bottom))]
        pt-[max(10px,env(safe-area-inset-top))]
        ps-[max(12px,env(safe-area-inset-left))]
        pe-[max(12px,env(safe-area-inset-right))]
      "
    >
      {/* 背景画像 */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: "url('/assets/bg-front.webp')",
          backgroundSize: 'contain',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
          backgroundColor: '#120d12',
        }}
        aria-hidden="true"
      />

      {/* 暗幕（可読性UP） */}
      <div
        className="absolute inset-0"
        style={{
          background: `linear-gradient(to bottom,
            rgba(0,0,0,0.35) 0%,
            rgba(0,0,0,0.20) 35%,
            rgba(0,0,0,0.20) 65%,
            rgba(0,0,0,0.70) 100%
          )`,
        }}
        aria-hidden="true"
      />

      {/* ネオンにじみ（雰囲気） */}
      <div
        className="pointer-events-none absolute -top-24 -left-24 w-[28rem] h-[28rem] rounded-full blur-[140px]"
        style={{ background: 'rgba(255,90,120,0.20)' }}
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute top-1/3 -right-28 w-[28rem] h-[28rem] rounded-full blur-[140px]"
        style={{ background: 'rgba(80,160,255,0.16)' }}
        aria-hidden="true"
      />

      {/* UI本体 */}
      <div className="relative z-10 px-4 pt-0 pb-3 flex flex-col h-full animate-fadeIn">
        {/* ロゴブロック */}
        <header className="text-center shrink-0 pt-1 pb-0">
          <div className="inline-flex flex-col items-center gap-[0.9em] sm:gap-[1.1em]">
            <div className="inline-block relative">
              <img
                src="/assets/logo.png"
                alt="スナック蒸発"
                className="w-[min(240px,72vw)] sm:w-[min(320px,85vw)] mx-auto rounded-md
                           drop-shadow-[0_0_12px_rgba(255,90,120,.35)]"
              />
              <div className="absolute inset-0 rounded-md blur-xl opacity-40 bg-snack-neon-pink/30 -z-10" />
            </div>

            <p
              className="
                text-[11px] sm:text-[13px]
                leading-[1]
                text-snack-text-dim/90
                tracking-[0.15em] sm:tracking-[0.25em]
                uppercase italic
                drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]
              "
            >
              VIRTUAL SNACK – NO TRACE
            </p>
          </div>
        </header>

        {/* メイン */}
        <main className="mt-3 flex-1 min-h-0 flex flex-col justify-between gap-2 sm:gap-6 pb-28">
          <section className="pb-1">
            <h2 className="text-sm mb-2 sm:mb-6 text-snack-text-dim border-b border-snack-panel pb-1">
              今日の気分
            </h2>

            <div className="grid grid-cols-1 gap-3">
              {[
                {
                  id: 'relax',
                  label: ' 癒されたい',
                  color: 'bg-[#3a1f2a]/60 text-[#f0c9d5]',
                },
                {
                  id: 'listen',
                  label: ' 話を聞いてほしい',
                  color: 'bg-[#1f2d3a]/60 text-[#c9def0]',
                },
                {
                  id: 'advise',
                  label: ' 悩みを相談したい',
                  color: 'bg-[#1f3a2b]/60 text-[#cfead8]',
                },
              ].map((m) => (
                <button
                  key={m.id}
                  onClick={() => setMood(m.id)}
                  className={`
                    py-2.5 px-3 sm:py-3 sm:px-4 rounded-lg text-left font-bold transition-all
                    ${m.color}
                    ${
                      mood === m.id
                        ? 'ring-2 ring-snack-neon-pink scale-[1.02]'
                        : 'opacity-70 hover:opacity-90'
                    }
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
                className={[
                  'flex-1 py-2 rounded-full text-sm transition duration-200',
                  mode === 'text'
                    ? [
                        'bg-gradient-to-r',
                        'from-[rgba(244,98,161,1)]',
                        'to-[rgba(160,120,255,0.78)]',
                        'text-snack-bg',
                        'font-bold',
                        'shadow-neon-pinkviolet',
                        'hover:brightness-105',
                        'active:brightness-95',
                        'focus-visible:outline-none',
                        'focus-visible:ring-2',
                        'focus-visible:ring-[rgba(244,98,161,0.5)]',
                      ].join(' ')
                    : [
                        'text-snack-text-dim',
                        'hover:text-snack-text',
                        'focus-visible:outline-none',
                        'focus-visible:ring-2',
                        'focus-visible:ring-white/10',
                      ].join(' ')
                ].join(' ')}
                onClick={() => setMode('text')}
              >
                テキストのみ
              </button>

              <button
                className={[
                  'flex-1 py-2 rounded-full text-sm transition duration-200',
                  mode === 'voice'
                    ? [
                        'bg-gradient-to-r',
                        'from-[rgba(244,98,161,1)]',
                        'to-[rgba(160,120,255,0.78)]',
                        'text-snack-bg',
                        'font-bold',
                        'shadow-neon-pinkviolet',
                        'hover:brightness-105',
                        'active:brightness-95',
                        'focus-visible:outline-none',
                        'focus-visible:ring-2',
                        'focus-visible:ring-[rgba(244,98,161,0.5)]',
                      ].join(' ')
                    : [
                        'text-snack-text-dim',
                        'hover:text-snack-text',
                        'focus-visible:outline-none',
                        'focus-visible:ring-2',
                        'focus-visible:ring-white/10',
                      ].join(' ')
                ].join(' ')}
                onClick={() => setMode('voice')}
              >
                音声のみ
              </button>
            </div>

            <p className="text-[11px] text-snack-text-dim leading-relaxed">
              ・<span className="font-semibold text-snack-neon-blue">テキストのみ</span>
              ：このアプリ内の文字だけで、しっぽりお話しします。<br />
              ・<span className="font-semibold text-snack-neon-blue">音声のみ</span>
              ：声だけで、落ち着いてお話しします（映像はありません）。
            </p>
          </section>

          <button
            type="button"
            onClick={handleEvaporate}
            className={`evaporate-btn ${isPuffing ? 'is-pop' : ''} fixed
              left-[max(12px,env(safe-area-inset-left))]
              right-[max(12px,env(safe-area-inset-right))]
              bottom-[max(24px,env(safe-area-inset-bottom))]
              z-30
              pt-3 pb-2 sm:pt-3.5 sm:pb-2.5
              rounded-2xl
              text-base sm:text-lg font-bold text-white
              bg-snack-neon-pink/90
              border border-white/25
              shadow-[0_0_12px_rgba(255,90,120,0.45),0_0_26px_rgba(255,90,120,0.30)]
              transition-all duration-500
              hover:bg-snack-neon-pink/95
              active:scale-[0.97]
            `}
          >
            <span className="evaporate-flash" />
            <span className="evaporate-ring" />
            <span className="relative z-10 flex flex-col items-center leading-none">
              <span className="drop-shadow-[0_1px_0_rgba(0,0,0,0.65)]">
                蒸発する
              </span>
              <span className="mt-1 text-[11px] sm:text-[12px] font-semibold tracking-[0.12em] text-white/90">
                店に入る
              </span>
            </span>
          </button>
        </main>
      </div>
    </div>
  );
};

export default TopSelection;
