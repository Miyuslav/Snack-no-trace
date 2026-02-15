// frontend/src/components/SessionRoom.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

export default function SessionRoom({ sessionInfo, socket, onLeave }) {
  // ✅ 固定セッション部屋ID（.envで上書き可）
  const rid = import.meta.env.VITE_MAMA_ROOM_ID || "room_mama_fixed";

  // =========================
  // Mode
  // =========================
  const mode = useMemo(() => sessionInfo?.mode || "text", [sessionInfo?.mode]);
  const isText = mode === "text";
  const isVoice = mode === "voice";

  // =========================
  // UI / sounds / refs
  // =========================
  const cheersSoundRef = useRef(null);
  const leaveSoundRef = useRef(null);
  const payWinRef = useRef(null);

  const [tipEffect, setTipEffect] = useState(false);
  const [tipOpen, setTipOpen] = useState(false);
  const [tipLoading, setTipLoading] = useState(false);

  const TIP_OPTIONS = useMemo(() => [100, 300, 500], []);

  // =========================
  // Chat (text mode)
  // =========================
  const CHAT_KEY = useMemo(() => `snack_chat_${rid}`, [rid]);

  const [messages, setMessages] = useState(() => {
    try {
      const raw = localStorage.getItem(CHAT_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  const [input, setInput] = useState("");

  const addMessage = useCallback((from, text) => {
    setMessages((prev) => [...prev, { id: prev.length + 1, from, text }]);
  }, []);

  useEffect(() => {
    try {
      const trimmed = messages.slice(-200);
      localStorage.setItem(CHAT_KEY, JSON.stringify(trimmed));
    } catch {}
  }, [CHAT_KEY, messages]);

  // =========================
  // Voice (Daily)
  // =========================
  const callRef = useRef(null);
  const debugIntervalRef = useRef(null);

  const [voiceStatus, setVoiceStatus] = useState("idle"); // idle | joining | joined | failed
  const voiceInfo = useMemo(() => sessionInfo?.voiceInfo || null, [sessionInfo?.voiceInfo]);
  const [voiceErr, setVoiceErr] = useState("");

  const destroyCall = useCallback(async () => {
    if (debugIntervalRef.current) {
      window.clearInterval(debugIntervalRef.current);
      debugIntervalRef.current = null;
    }

    const call = callRef.current;
    callRef.current = null;

    setVoiceStatus("idle");
    setVoiceErr("");

    if (call) {
      try {
        await call.leave();
      } catch {}
      try {
        call.destroy();
      } catch {}
    }
  }, []);

  const joinVoice = useCallback(async () => {
    setVoiceErr("");

    if (!voiceInfo?.roomUrl) {
      setVoiceStatus("failed");
      setVoiceErr("音声の準備中です（session.started に voiceInfo が来るまで待ってね）");
      return;
    }
    if (voiceStatus === "joining" || voiceStatus === "joined") return;

    try {
      setVoiceStatus("joining");

      const { default: Daily } = await import("@daily-co/daily-js");
      const call = Daily.createCallObject({ videoSource: false });
      callRef.current = call;

      call.on("joined-meeting", () => {
        setVoiceStatus("joined");
        try {
          call.setLocalAudio(true);
        } catch {}
      });

      call.on("left-meeting", () => setVoiceStatus("idle"));
      call.on("error", (e) => {
        setVoiceStatus("failed");
        setVoiceErr(e?.errorMsg || e?.message || "Daily error");
      });

      await call.join({
        url: voiceInfo.roomUrl,
        token: voiceInfo.token || undefined,
        videoSource: false,
      });

      try {
        await call.setLocalAudio(true);
      } catch {}
      try {
        await call.setLocalVideo(false);
      } catch {}

      // デバッグ観測（必要なら）
      try {
        call.startLocalAudioLevelObserver(200);
        call.startRemoteParticipantsAudioLevelObserver(200);
      } catch {}

      debugIntervalRef.current = window.setInterval(() => {
        try {
          // eslint-disable-next-line no-console
          console.log("[Daily] participants", Object.keys(call.participants?.() || {}));
        } catch {}
      }, 1500);

      addMessage("system", "🔊 音声ルームに入りました");
    } catch (e) {
      setVoiceStatus("failed");
      setVoiceErr(e?.message || "join failed");
      await destroyCall();
      addMessage("system", "⚠️ 音声ルームに入れませんでした");
    }
  }, [voiceInfo, voiceStatus, destroyCall, addMessage]);

  const leaveVoice = useCallback(async () => {
    addMessage("system", "🔇 音声ルームから退出しました");
    await destroyCall();
  }, [destroyCall, addMessage]);

  // voiceInfoが来たら自動で一回だけ join
  const autoJoinedRef = useRef(false);
  useEffect(() => {
    if (!isVoice) {
      autoJoinedRef.current = false;
      return;
    }
    if (!voiceInfo?.roomUrl) return;
    if (autoJoinedRef.current) return;
    autoJoinedRef.current = true;
    joinVoice();
  }, [isVoice, voiceInfo?.roomUrl, joinVoice]);

  // =========================
  // Sounds init
  // =========================
  useEffect(() => {
    if (typeof window === "undefined" || typeof Audio === "undefined") return;

    cheersSoundRef.current = new Audio("/kanpai.mp3");
    cheersSoundRef.current.volume = 0.6;

    leaveSoundRef.current = new Audio("/door_out.mp3");
    leaveSoundRef.current.volume = 0.7;
  }, []);

  // =========================
  // Socket handlers
  // =========================
  useEffect(() => {
    if (!socket) return;

    const onChat = ({ from, text }) => {
      if (!isText) return;
      addMessage(from === "mama" ? "mama" : "user", text);
    };

    const onEnded = ({ reason }) => {
      addMessage("system", `セッションが終了しました（理由: ${reason}）`);
      if (isVoice) leaveVoice();
      onLeave?.();
    };

    socket.on("chat.message", onChat);
    socket.on("session.ended", onEnded);

    return () => {
      socket.off("chat.message", onChat);
      socket.off("session.ended", onEnded);
    };
  }, [socket, isText, isVoice, addMessage, leaveVoice, onLeave]);

  // =========================
  // Mode change reset
  // =========================
  useEffect(() => {
    setMessages([]);
    setInput("");
    setTipOpen(false);
    setTipLoading(false);

    setVoiceStatus("idle");
    setVoiceErr("");
    autoJoinedRef.current = false;

    return () => {
      destroyCall();
    };
  }, [mode, destroyCall]);

  // =========================
  // Actions
  // =========================
  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed) return;

    addMessage("user", trimmed);
    setInput("");
    socket?.emit("guest.message", { text: trimmed });
  }, [input, addMessage, socket]);

  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSend();
    }
  };
 const footerRef = useRef(null);

 useEffect(() => {
   const onFocusIn = () => {
     setTimeout(() => {
       footerRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
     }, 50);
   };
   window.addEventListener("focusin", onFocusIn);
   return () => window.removeEventListener("focusin", onFocusIn);
 }, []);

  const bottomRef = useRef(null);

  useEffect(() => {
    // messages が増えたら最下部へ
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);


  const handleCheers = () => {
    if (!isText) return;

    try {
      if (cheersSoundRef.current) cheersSoundRef.current.currentTime = 0;
      cheersSoundRef.current?.play?.();
    } catch {}

    const userText = "🍸 乾杯！";
    addMessage("user", userText);
    socket?.emit("guest.message", { text: userText });

    window.setTimeout(() => {
      try {
        if (cheersSoundRef.current) cheersSoundRef.current.currentTime = 0;
        cheersSoundRef.current?.play?.();
      } catch {}
      addMessage("mama", "🍸 乾杯！");
      setTipEffect(true);
      window.setTimeout(() => setTipEffect(false), 900);
    }, 800);
  };

  const handleConsult = () => {
    if (!isText) return;
    const text = "ちょっと相談したいことがあるんだ。";
    addMessage("user", text);
    socket?.emit("guest.message", { text });
  };

  const handleTip = () => {
    if (!isText) return;
    setTipOpen(true);
  };
  // =====================================================
  // Tip payment helpers
  // =====================================================

  // ✅ API_BASE はコンポーネント直下で1回だけ決める（Vercel→Fly 404対策）
  const API_BASE = useMemo(
    () =>
      import.meta.env.VITE_API_URL ||
      `${window.location.protocol}//${window.location.hostname}:4000`,
    []
  );

  // ✅ Fly auto-stop 起動待ちリトライ付き POST
  const postJsonWithRetry = useCallback(async (url, payload, tries = 3) => {
    let lastErr = null;

    for (let i = 0; i < tries; i++) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          credentials: "include",
        });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        return await res.json();
      } catch (err) {
        lastErr = err;
        await new Promise((r) => setTimeout(r, 800 * (i + 1)));
      }
    }

    throw lastErr;
  }, []);

  // ✅ これ1つだけにする（中でuseCallbackしない！）
  const startTipPayment = useCallback(
    async (amount) => {
      // 0) 演出ログ
      const text = `💸 チップ ¥${amount} をはずむ。`;
      addMessage("user", text);
      socket?.emit("guest.message", { text });
      socket?.emit("guest.tip", { amount });

      // 1) iPhone Safari 判定
      const ua = navigator.userAgent;
      const isIOS =
        /iP(hone|ad|od)/.test(ua) ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
      const isSafari = /Safari/.test(ua) && !/Chrome|CriOS|Android/.test(ua);
      const isIPhoneSafari = isIOS && isSafari;

      // 2) 実行
      setTipLoading(true);
      try {
        if (!rid) {
          addMessage("system", "roomId が無いので決済できません");
          return;
        }

        const url = `${API_BASE}/api/create-checkout-session`;

        let data;
        try {
          data = await postJsonWithRetry(
            url,
            { amount, roomId: rid, socketId: socket?.id || "" },
            3
          );
        } catch (e) {
          console.error("[TIP] create-checkout-session failed:", e);
          addMessage("system", `決済の準備に失敗しました（${e?.message || "unknown"}）`);
          return;
        }

        if (!data?.url) {
          console.error("[TIP] invalid response:", data);
          addMessage("system", "決済URLが取得できませんでした");
          return;
        }

        // 3) Stripe Checkoutへ遷移
        if (isIPhoneSafari) {
          window.location.assign(data.url);
        } else {
          const payWin = window.open("about:blank", "_blank");
          payWinRef.current = payWin;

          if (!payWin) {
            addMessage("system", "ポップアップがブロックされました。許可して再試行してね🙏");
            return;
          }
          payWin.location.replace(data.url);
        }
      } finally {
        setTipLoading(false);
        setTipOpen(false);
      }
    },
    [API_BASE, rid, socket, addMessage, postJsonWithRetry]
  );

  const voiceStatusLabel =
    voiceStatus === "idle"
      ? "未接続"
      : voiceStatus === "joining"
      ? "接続中..."
      : voiceStatus === "joined"
      ? "通話中"
      : "失敗";

  const handleLeaveAll = useCallback(() => {
    if (isVoice) leaveVoice();

    try {
      if (leaveSoundRef.current) {
        leaveSoundRef.current.currentTime = 0;
        leaveSoundRef.current.play();
      }
    } catch {}

    window.setTimeout(() => onLeave?.(), 400);
  }, [isVoice, leaveVoice, onLeave]);

    // =========================
    // Render（高級ラウンジ：詰め＆小さめ文字）
    // =========================
    return (
      <div className="relative min-h-[var(--app-height)] overflow-hidden text-white bg-black">
        <div className="absolute inset-0 bg-black" />

        {/* 額縁 */}
        <div className="absolute inset-3 sm:inset-4 md:inset-6">
          <div
            className={[
              "relative h-full rounded-[26px] overflow-hidden",
              "border border-white/10",
              "shadow-[0_24px_80px_rgba(0,0,0,0.65)]",
              tipEffect ? "ring-2 ring-snack-neon-pink/40 shadow-neon-pink" : "",
            ].join(" ")}
          >
            {/* BG */}
            <div
              className="absolute inset-0"
              style={{
                backgroundImage: "url('/assets/session.jpg')",
                backgroundRepeat: "no-repeat",
                backgroundPosition: "center",
                backgroundSize: "cover",
              }}
            />
            <div className="absolute inset-0 bg-black/20" />
            <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/25 to-black/70" />
            <div className="absolute inset-0 [box-shadow:inset_0_0_120px_rgba(0,0,0,0.78)]" />

            {/* UI */}
            <div className="relative z-10 flex h-full min-h-0 flex-col">
              {/* ===== 上部ヘッダー（小さく） ===== */}
              <div className="relative shrink-0 h-20 sm:h-24">
                <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-transparent to-black/30" />

                {/* ON AIR */}
                <div className="absolute left-4 bottom-3">
                  <span className="bg-snack-neon-pink/85 text-white text-[10px] px-2 py-1 rounded">
                    ON AIR
                  </span>
                </div>

                {/* ✅ もう帰る：右上に小さく固定 */}
                <div className="absolute right-3 top-3">
                  <button
                    type="button"
                    onClick={handleLeaveAll}
                    className="rounded-full border border-white/15 bg-white/10 text-white/75
                               px-3 py-1.5 text-[12px] font-semibold hover:bg-white/15 active:scale-[0.99]"
                    aria-label="もう帰る"
                  >
                    もう帰る
                  </button>
                </div>

                {/* 細線 */}
                <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-white/12 to-transparent" />
              </div>

              {/* ===== VOICE ===== */}
              {isVoice ? (
                <div className="mx-4 mt-4 rounded-2xl border border-white/10 bg-black/35 px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="text-[12px] text-[#E6E0D8] leading-relaxed">
                      🎙 音声のみモード / 状態：
                      <span className="text-snack-neon-blue"> {voiceStatusLabel}</span>
                      <div className="text-[11px] text-white/60 mt-1">
                        ※ iPhone は「再接続」を押したタイミングでマイク許可が出ます
                      </div>
                    </div>

                    <div className="flex gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={joinVoice}
                        disabled={voiceStatus === "joining" || voiceStatus === "joined" || !voiceInfo}
                        className="px-3 py-2 rounded-full text-[12px] font-semibold bg-snack-neon-blue text-black disabled:opacity-40"
                      >
                        {voiceStatus === "joined" ? "通話中" : "再接続"}
                      </button>

                      <button
                        type="button"
                        onClick={leaveVoice}
                        disabled={voiceStatus !== "joined"}
                        className="px-3 py-2 rounded-full text-[12px] font-semibold border border-white/25 text-white/80 disabled:opacity-40"
                      >
                        退出
                      </button>
                    </div>
                  </div>

                  {!voiceInfo ? (
                    <div className="mt-2 text-[11px] text-yellow-200">
                      音声の準備待ちです（session.started に voiceInfo が乗るまで待機）
                    </div>
                  ) : null}

                  {voiceErr ? (
                    <div className="mt-2 text-[11px] text-red-300 whitespace-pre-wrap">{voiceErr}</div>
                  ) : null}

                  <div className="mt-3 rounded-xl border border-white/10 bg-black/25 px-4 py-3 text-[12px] text-white/70 leading-relaxed">
                    上の「再接続」を押すだけで開始できます。失敗したらマイク許可を確認してね。
                  </div>
                </div>
              ) : null}

              {/* ===== TEXT ===== */}
              {isText ? (
                <>
                  {/* チャット欄：余白を詰めて文字も小さめ */}
                  <div className="flex-1 min-h-0 mx-4 mt-4 mb-3 rounded-2xl border border-white/10 bg-black/28 p-4 overflow-y-auto overscroll-contain space-y-3">
                    <div className="text-center text-[11px] text-white/60 my-1">
                      —— ママが入店しました ——
                    </div>

                    {messages.map((m) => {
                      if (m.from === "system") {
                        return (
                          <div key={m.id} className="flex w-full justify-center">
                            <span className="text-[12px] text-[#E6E0D8] drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]">
                              {m.text}
                            </span>
                          </div>
                        );
                      }

                      const isMama = m.from === "mama";
                      return (
                        <div key={m.id} className={`flex w-full ${isMama ? "justify-start" : "justify-end"}`}>
                          <div
                            className={`max-w-[82%] px-3 py-2 rounded-2xl text-[14px] leading-[1.6] ${
                              isMama
                                ? "bg-black/45 text-[#F4EBDD] drop-shadow-[0_2px_4px_rgba(0,0,0,0.55)] rounded-tl-none"
                                : "ml-auto bg-[#f1e6d6] text-[#2b1c12] shadow-[0_4px_14px_rgba(0,0,0,0.22)] rounded-tr-none"
                            }`}
                          >
                            {m.text}
                          </div>
                        </div>
                      );
                    })}
                   <div ref={bottomRef} />
                  </div>
                  {/* 下部操作：コンパクト */}
                  <footer
                    ref={footerRef}
                    className="mx-4 mb-4 rounded-2xl border border-white/10 bg-black/32 p-3 pb-[calc(16px+env(safe-area-inset-bottom))]">
                    <div className="flex gap-2 mb-2">
                      <button
                        type="button"
                        onClick={handleCheers}
                        className="flex-1 bg-yellow-900/30 border border-yellow-600/55 text-yellow-200 py-2 rounded-full text-[12px]"
                      >
                        🍸 乾杯
                      </button>
                      <button
                        type="button"
                        onClick={handleConsult}
                        className="flex-1 bg-snack-neon-blue/12 border border-snack-neon-blue/55 text-snack-neon-blue py-2 rounded-full text-[12px]"
                      >
                        相談
                      </button>
                      <button
                        type="button"
                        onClick={handleTip}
                        className="flex-1 bg-snack-neon-pink/10 border border-snack-neon-pink/55 text-snack-neon-pink py-2 rounded-full text-[12px]"
                      >
                        チップ
                      </button>
                    </div>

                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="メッセージを入力..."
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        className="flex-grow bg-black/45 border border-white/15 rounded-full px-4 py-2 text-[16px] focus:outline-none focus:border-snack-neon-pink/80"
                      />
                      <button
                        type="button"
                        onClick={handleSend}
                        className="bg-snack-neon-pink/90 rounded-full shrink-0 w-11 h-11 flex items-center justify-center shadow-neon-pink active:scale-95 transition-transform"
                        aria-label="送信"
                      >
                        ▶
                      </button>
                    </div>
                  </footer>
                </>
              ) : null}

              {/* 想定外 */}
              {!isText && !isVoice ? (
                <div className="p-6 text-[12px] text-yellow-200">
                  sessionInfo.mode が不明です。サーバの session.started に mode を含めてください。
                </div>
              ) : null}

              {/* Tip modal（textのみ） */}
              {isText && tipOpen ? (
                <div className="absolute inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm p-4 pb-[calc(16px+env(safe-area-inset-bottom))]">
                  <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#1c1715]/95 p-4 shadow-xl">
                    <div className="flex items-center justify-between mb-3">
                      <div className="text-sm text-snack-text">チップの金額を選んでね</div>
                      <button
                        type="button"
                        onClick={() => (tipLoading ? null : setTipOpen(false))}
                        className="text-xs text-gray-300 px-2 py-1 rounded-full border border-gray-600"
                      >
                        閉じる
                      </button>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      {TIP_OPTIONS.map((a) => (
                        <button
                          key={a}
                          type="button"
                          disabled={tipLoading}
                          onClick={() => startTipPayment(a)}
                          className="py-3 rounded-xl border border-snack-neon-pink/40 bg-snack-neon-pink/10 text-snack-neon-pink text-sm active:scale-95 transition-transform disabled:opacity-60"
                        >
                          ¥{a}
                        </button>
                      ))}
                    </div>

                    <div className="mt-3 text-[11px] text-gray-400">※ お支払い画面（PayPay等）に移動します</div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    );
}
