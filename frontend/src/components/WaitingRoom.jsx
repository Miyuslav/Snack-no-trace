import React, { useRef } from 'react';

const WaitingRoom = ({ sessionInfo, onCancel }) => {
  const evapSoundRef = useRef(null);

  const playEvapSoft = () => {
    if (typeof window === 'undefined' || typeof Audio === 'undefined') return;

    try {
      if (!evapSoundRef.current) {
        const a = new Audio('/door_out.mp3');
        a.preload = 'auto';
        a.volume = 0.2; // 弱め
        evapSoundRef.current = a;
      }

      const a = evapSoundRef.current;
      a.currentTime = 0;
      a.play().catch(() => {});
    } catch (e) {
      console.warn('evap sound error', e);
    }
  };

  const moodLabel =
    sessionInfo?.mood === 'relax'
      ? '癒されたい'
      : sessionInfo?.mood === 'listen'
      ? '話を聞いてほしい'
      : sessionInfo?.mood === 'advise'
      ? '悩みを相談したい'
      : 'おまかせ';

  const modeLabel =
    sessionInfo?.mode === 'voice' ? '音声のみ' : 'テキストのみ';

  return (
    <div
      className="
        relative min-h-[100dvh] overflow-hidden
        text-snack-text animate-fadeIn
        bg-gradient-to-b from-[#1A2F55] via-[#23457A] to-[#1A2F55]
        pb-[max(16px,env(safe-area-inset-bottom))]
        pt-[max(10px,env(safe-area-inset-top))]
      "
    >
      {/* うっすら霧（ネイビーで上品に） */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(1000px 520px at 50% 20%, rgba(90,140,200,0.22), transparent 62%),' +
            'radial-gradient(900px 520px at 50% 60%, rgba(80,130,190,0.20), transparent 65%)',
        }}
        aria-hidden="true"
      />

      {/* 本体 */}
      <div className="relative z-10 min-h-[100dvh] flex flex-col">
        {/* ヘッダー（看板っぽく） */}
        <header className="text-center py-7 border-b border-[rgba(160,200,255,0.25)] bg-[rgba(26,47,85,0.35)] backdrop-blur-[1px]">
          <div className="inline-block relative">
            <div
              className="
                relative
                rounded-xl
                px-3 py-3
                bg-[rgba(30,55,100,0.75)]
                border border-[rgba(160,200,255,0.45)]
                shadow-[0_10px_30px_rgba(0,0,0,0.35)]
              "
            >
              <img
                src="/assets/logo.png"
                alt="スナック蒸発"
                className="
                  w-[260px] sm:w-[300px] mx-auto
                  rounded-md
                  drop-shadow-[0_2px_6px_rgba(0,0,0,0.35)]
                "
              />
              <div
                className="
                  pointer-events-none absolute inset-1
                  rounded-lg
                  border border-[rgba(180,215,255,0.35)]
                "
              />
            </div>
          </div>

          <p
            className="
              mt-4 text-[12px]
              text-[rgba(200,220,255,0.85)]
              tracking-[0.28em] uppercase
              drop-shadow-[0_1px_2px_rgba(0,0,0,0.4)]
            "
          >
            NO TRACE – WAITING LOUNGE
          </p>
        </header>

        {/* メイン */}
        <main className="flex-1 px-6 py-6 flex flex-col gap-6">
          {/* ママ準備中 */}
          <section className="bg-[rgba(26,47,85,0.55)] border border-[rgba(160,200,255,0.35)] rounded-2xl p-4 backdrop-blur-[1px]">
            <p className="text-xs text-[rgba(200,220,255,0.75)] mb-1">
              ステータス
            </p>

            <div className="flex items-center gap-3">
              <div className="relative">
                <span className="flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[rgba(120,170,240,0.95)] opacity-25" />
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-[rgba(120,170,240,0.95)]" />
                </span>
              </div>

              <div>
                <p className="text-sm font-semibold text-white/90">
                  ママがグラスを拭きながら、あなたを迎える準備をしています…
                </p>
                <p className="text-xs text-white/60 mt-1">
                  画面はこのままで大丈夫です。そのままお待ちください。
                </p>
              </div>
            </div>
          </section>

          {/* オーダー内容 */}
          <section className="bg-[rgba(26,47,85,0.55)] border border-[rgba(160,200,255,0.35)] rounded-2xl p-4 text-sm backdrop-blur-[1px]">
            <p className="text-xs text-[rgba(200,220,255,0.75)] mb-2">
              今日のオーダー内容
            </p>

            <div className="space-y-1">
              <div className="flex justify-between">
                <span className="text-white/65">気分</span>
                <span className="font-semibold text-white/90">{moodLabel}</span>
              </div>

              <div className="flex justify-between">
                <span className="text-white/65">モード</span>
                <span className="font-semibold text-white/90">{modeLabel}</span>
              </div>
            </div>
          </section>

          {/* 音声案内：voice のときだけ表示 */}
          {sessionInfo?.mode === 'voice' && (
            <section className="bg-[rgba(26,47,85,0.55)] border border-[rgba(160,200,255,0.35)] rounded-2xl p-4 text-sm backdrop-blur-[1px]">
              <p className="text-xs text-[rgba(200,220,255,0.9)] mb-2">
                音声のみのご案内
              </p>
              <p className="text-xs text-white/70 leading-relaxed">
                まもなく音声での対話が始まります。<br />
                端末のマイクが使える状態かだけ確認して、そのままお待ちください。
              </p>
              <p className="mt-2 text-[10px] text-white/55">
                ※映像はありません（顔出しなし）
              </p>
            </section>
          )}

          {/* もう帰るボタン（右寄り 1/3 + hover青発光） */}
          <div className="mt-auto pt-6 border-t border-[rgba(160,200,255,0.18)] flex justify-end">
            <button
              type="button"
              onClick={() => {
                playEvapSoft();
                setTimeout(() => onCancel(), 120);
              }}
              className="
                w-1/3 py-2 text-[11px] rounded-md text-center
                border border-[rgba(160,200,255,0.35)] text-white/60
                transition-all duration-200
                hover:text-white/80
                hover:border-[rgba(120,180,255,0.55)]
                hover:shadow-[0_0_10px_rgba(120,180,255,0.25)]
                hover:bg-[rgba(120,180,255,0.06)]
              "
            >
              今日はやめとく...
            </button>
          </div>
        </main>
      </div>
    </div>
  );
};

export default WaitingRoom;
