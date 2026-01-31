import React, { useRef, useState, useEffect,useCallback} from 'react';
import Daily from '@daily-co/daily-js';

const WaitingRoom = ({ sessionInfo, onCancel }) => {
  // ===== SFX =====
  const evapSoundRef = useRef(null);

  const playEvapSoft = useCallback(() => {
    if (typeof window === 'undefined' || typeof Audio === 'undefined') return;

    try {
      if (!evapSoundRef.current) {
        const a = new Audio('/door_out.mp3');
        a.preload = 'auto';
        a.volume = 0.2;
        evapSoundRef.current = a;
      }
      const a = evapSoundRef.current;
      a.currentTime = 0;
      a.play().catch(() => {});
    } catch (e) {
      console.warn('evap sound error', e);
    }
  }, []);

  const moodLabel =
    sessionInfo?.mood === 'relax'
      ? '癒されたい'
      : sessionInfo?.mood === 'listen'
      ? '話を聞いてほしい'
      : sessionInfo?.mood === 'advise'
      ? '悩みを相談したい'
      : 'おまかせ';

  const modeLabel = sessionInfo?.mode === 'voice' ? '音声のみ' : 'テキストのみ';

  // ===== Voice (Daily) =====
  const callRef = useRef(null);
  const [voiceStatus, setVoiceStatus] = useState('idle'); // idle|ready|joining|joined|failed
  const [voiceInfo, setVoiceInfo] = useState(null); // { roomUrl, token, resumed }

  const destroyCall = async () => {
    const call = callRef.current;
    callRef.current = null;
    setVoiceInfo(null);
    setVoiceStatus('idle');

    if (call) {
      try {
        await call.leave();
      } catch {}
      try {
        call.destroy();
      } catch {}
    }
  };

  const joinVoice = async ({ roomUrl, token, resumed }) => {
    if (!roomUrl) return;
    if (voiceStatus === 'joined' || voiceStatus === 'joining') return;

    try {
      setVoiceStatus('joining');

      const call = Daily.createCallObject({
        videoSource: false, // ✅ 音声のみ
      });
      callRef.current = call;

      call.on('joined-meeting', () => setVoiceStatus('joined'));
      call.on('left-meeting', () => setVoiceStatus('idle'));
      call.on('error', (e) => {
        console.warn('[Daily error]', e);
        setVoiceStatus('failed');
      });

      // ✅ iPhone: “ボタン押下中”に join が走るのが超重要
      await call.join({
        url: roomUrl,
        token,
        videoSource: false,
      });

      // joined-meeting が走って joined になる
      console.log('[Daily] joined', { resumed: !!resumed });
    } catch (e) {
      console.warn('[joinVoice] failed', e);
      setVoiceStatus('failed');
      await destroyCall();
    }
  };

  const requestVoiceJoin = () => {
    // token 取りに行くだけ（マイク許可はまだ）
    setVoiceStatus('joining');
  };

  // voice token 受け取り
  useEffect(() => {
    const onVoiceReady = (payload) => {
      // { roomUrl, token, resumed }
      setVoiceInfo(payload);
      setVoiceStatus('ready');
      console.log('[voice.join.ready]', payload);
    };

    const onVoiceDenied = ({ reason }) => {
      setVoiceStatus('failed');
      console.warn('[voice.join.denied]', reason);
    };

  }, []);

  // 退出時は必ず音声も掃除
  useEffect(() => {
    return () => {
      destroyCall();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const voiceButtonLabel =
    voiceStatus === 'joined'
      ? '音声 入室中'
      : voiceInfo
      ? '音声を開始（マイク許可）'
      : voiceStatus === 'joining'
      ? '準備中...'
      : '音声を準備';

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

      <div className="relative z-10 min-h-[100dvh] flex flex-col">
        {/* ヘッダー */}
        <header className="text-center py-7 border-b border-[rgba(160,200,255,0.25)] bg-[rgba(26,47,85,0.35)] backdrop-blur-[1px]">
          <div className="inline-block relative">
            <div
              className="
                relative rounded-xl px-3 py-3
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
              <div className="pointer-events-none absolute inset-1 rounded-lg border border-[rgba(180,215,255,0.35)]" />
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

        <main className="flex-1 px-6 py-6 flex flex-col gap-6">
          {/* ステータス */}
          <section className="bg-[rgba(26,47,85,0.55)] border border-[rgba(160,200,255,0.35)] rounded-2xl p-4 backdrop-blur-[1px]">
            <p className="text-xs text-[rgba(200,220,255,0.75)] mb-1">ステータス</p>

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

          {/* オーダー */}
          <section className="bg-[rgba(26,47,85,0.55)] border border-[rgba(160,200,255,0.35)] rounded-2xl p-4 text-sm backdrop-blur-[1px]">
            <p className="text-xs text-[rgba(200,220,255,0.75)] mb-2">今日のオーダー内容</p>

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

          {/* ✅ 音声ボタン：voice のときだけ */}
          {sessionInfo?.mode === 'voice' && (
            <section className="bg-[rgba(26,47,85,0.55)] border border-[rgba(160,200,255,0.35)] rounded-2xl p-4 text-sm backdrop-blur-[1px]">
              <p className="text-xs text-[rgba(200,220,255,0.9)] mb-2">音声のみ</p>

              <div className="flex items-center justify-between gap-3">
                <div className="text-[12px] text-white/70">
                  状態：<span className="text-white/90">{voiceStatus}</span>
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      // 1回目：token準備 / 2回目：join（ここでマイク許可が出る）
                      if (!voiceInfo) requestVoiceJoin();
                      else joinVoice(voiceInfo);
                    }}
                    disabled={voiceStatus === 'joining' || voiceStatus === 'joined'}
                    className="
                      px-4 py-2 rounded-full text-xs font-semibold
                      bg-[rgba(80,160,255,0.95)] text-black
                      hover:brightness-105 active:brightness-95 transition
                      disabled:opacity-40
                    "
                  >
                    {voiceButtonLabel}
                  </button>

                  <button
                    type="button"
                    onClick={destroyCall}
                    disabled={voiceStatus !== 'joined'}
                    className="
                      px-4 py-2 rounded-full text-xs font-semibold
                      border border-[rgba(160,200,255,0.35)] text-white/75
                      hover:bg-[rgba(255,255,255,0.06)] transition
                      disabled:opacity-40
                    "
                  >
                    音声を抜ける
                  </button>
                </div>
              </div>

              <p className="mt-2 text-[10px] text-white/55">
                ※「音声を開始（マイク許可）」を押すと、iPhoneでマイク許可が出ます
              </p>
            </section>
          )}

          {/* もう帰る */}
          <div className="mt-auto pt-6 border-t border-[rgba(160,200,255,0.18)] flex justify-end">
            <button
              type="button"
              onClick={() => {
                playEvapSoft();
                destroyCall(); // ✅ 念のため
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
