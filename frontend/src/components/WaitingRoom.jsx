import React, { useRef, useState, useEffect, useCallback } from "react";

const WaitingRoom = ({ sessionInfo, onCancel, socket }) => {
  // ===== SFX =====
  const evapSoundRef = useRef(null);

  const playEvapSoft = useCallback(() => {
    if (typeof window === "undefined" || typeof Audio === "undefined") return;
    try {
      if (!evapSoundRef.current) {
        const a = new Audio("/door_out.mp3");
        a.preload = "auto";
        a.volume = 0.2;
        evapSoundRef.current = a;
      }
      const a = evapSoundRef.current;
      a.currentTime = 0;
      a.play().catch(() => {});
    } catch (e) {
      console.warn("evap sound error", e);
    }
  }, []);

  // ===== (Optional) Mic permission preflight =====
  // 方針A: 通話(join)は SessionRoom だけ。
  // WaitingRoom は「マイク許可だけ先に取る」程度にとどめる。
  const [micStatus, setMicStatus] = useState("idle"); // idle|checking|ready|denied

  const checkMicPermission = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setMicStatus("denied");
      return;
    }
    try {
      setMicStatus("checking");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      // すぐ解放（SessionRoomで改めてDaily join時に使う）
      stream.getTracks().forEach((t) => t.stop());
      setMicStatus("ready");
    } catch (e) {
      console.warn("[mic] permission denied", e);
      setMicStatus("denied");
    }
  }, []);

  // voiceモードのときだけ、待機中に1回チェックしておく（任意）
  useEffect(() => {
    if (sessionInfo?.mode !== "voice") return;
    // 自動で出したくないなら、このuseEffectは削って、ボタン押下型にしてもOK
    checkMicPermission();
  }, [sessionInfo?.mode, checkMicPermission]);

  // ===== UI Labels =====
  const moodLabel =
    sessionInfo?.mood === "relax" ? "癒されたい" :
    sessionInfo?.mood === "listen" ? "話を聞いてほしい" :
    sessionInfo?.mood === "advise" ? "悩みを相談したい" : "おまかせ";

  const modeLabel = sessionInfo?.mode === "voice" ? "音声のみ" : "テキストのみ";

  const micLabel =
    micStatus === "ready" ? "マイクOK" :
    micStatus === "checking" ? "マイク確認中..." :
    micStatus === "denied" ? "マイク許可が必要です" :
    "未確認";

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
      {/* うっすら霧 */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(1000px 520px at 50% 20%, rgba(90,140,200,0.22), transparent 62%)," +
            "radial-gradient(900px 520px at 50% 60%, rgba(80,130,190,0.20), transparent 65%)",
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

          {/* ✅ voice のときだけ：マイク事前確認（任意） */}
          {sessionInfo?.mode === "voice" && (
            <section className="bg-[rgba(26,47,85,0.55)] border border-[rgba(160,200,255,0.35)] rounded-2xl p-4 text-sm backdrop-blur-[1px]">
              <p className="text-xs text-[rgba(200,220,255,0.9)] mb-2">音声のみ</p>

              <div className="flex items-center justify-between gap-3">
                <div className="text-[12px] text-white/70">
                  マイク：<span className="text-white/90">{micLabel}</span>
                </div>

                <button
                  type="button"
                  onClick={checkMicPermission}
                  className="
                    px-4 py-2 rounded-full text-xs font-semibold
                    bg-[rgba(80,160,255,0.95)] text-black
                    hover:brightness-105 active:brightness-95 transition
                  "
                >
                  マイク確認
                </button>
              </div>

              <p className="mt-2 text-[10px] text-white/55">
                ※通話は「扉が開いたあと（セッション開始後）」に自動で接続します
              </p>
            </section>
          )}

          {/* もう帰る */}
          <div className="mt-auto pt-6 border-t border-[rgba(160,200,255,0.18)] flex justify-end">
            <button
              type="button"
              onClick={() => {
                playEvapSoft();
                onCancel();
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
