import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

// ✅ SessionRoomは socket を作らない。必ず props で受け取る。
const SessionRoom = ({ sessionInfo, onLeave, socket }) => {
  // =========================
  // Mode
  // =========================
  const mode = sessionInfo?.mode; // "text" | "voice"
  const isText = mode === "text";
  const isVoice = mode === "voice";

  // =========================
  // UI / sounds / refs
  // =========================
  const roomIdRef = useRef(sessionInfo?.roomId || null);

  const cheersSoundRef = useRef(null);
  const leaveSoundRef = useRef(null);

  const payWinRef = useRef(null);
  const tipTimerRef = useRef(null);

  const [tipEffect, setTipEffect] = useState(false);
  const [tipOpen, setTipOpen] = useState(false);
  const [tipLoading, setTipLoading] = useState(false);

  // チップ選択肢（元に合わせて変更OK）
  const TIP_OPTIONS = useMemo(() => [100, 300, 500], []);

  // API origin（元コードに合わせる）
  const API_ORIGIN =
    import.meta.env.VITE_API_ORIGIN ||
    import.meta.env.VITE_BACKEND_URL ||
    "http://localhost:4000";

  // 例：ポップアップ内で閉じるボタンを出すか（必要なら sessionInfo などで切替）
  const showCloseButton = false;

  // =========================
  // Chat (text mode)
  // =========================
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");

  const addMessage = useCallback((from, text) => {
    setMessages((prev) => [...prev, { id: prev.length + 1, from, text }]);
  }, []);

  // =========================
  // Voice (Daily)
  // =========================
  const callRef = useRef(null);
  const [voiceStatus, setVoiceStatus] = useState("idle"); // idle | ready | joining | joined | failed
  const [voiceInfo, setVoiceInfo] = useState(null); // { roomUrl, token, resumed? }
  const [voiceErr, setVoiceErr] = useState("");

  const destroyCall = useCallback(async () => {
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
    // iPhone重要：必ずボタン押下で呼ぶ
    setVoiceErr("");

    if (!voiceInfo?.roomUrl) {
      setVoiceStatus("failed");
      setVoiceErr("音声情報がまだ届いていません（voice.join.ready待ち）");
      return;
    }
    if (voiceStatus === "joining" || voiceStatus === "joined") return;

    try {
      setVoiceStatus("joining");

      const { default: Daily } = await import("@daily-co/daily-js");
      const call = Daily.createCallObject({ videoSource: false });
      callRef.current = call;

      call.on("joined-meeting", () => setVoiceStatus("joined"));
      call.on("left-meeting", () => setVoiceStatus("idle"));
      call.on("error", (e) => {
        console.warn("[Daily error]", e);
        setVoiceStatus("failed");
        setVoiceErr(e?.errorMsg || e?.message || "Daily error");
      });

      await call.join({
        url: voiceInfo.roomUrl,
        token: voiceInfo.token || undefined,
        videoSource: false,
      });

      addMessage("system", "🔊 音声ルームに入りました");
    } catch (e) {
      console.warn("[joinVoice] failed", e);
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

  // =========================
  // Sounds init
  // =========================
  useEffect(() => {
    if (typeof window === "undefined" || typeof Audio === "undefined") return;
    cheersSoundRef.current = new Audio("/kanpai.mp3"); // 元のパスに合わせて変更OK
    cheersSoundRef.current.volume = 0.6;

    leaveSoundRef.current = new Audio("/door_out.mp3"); // 元の退出音に合わせて変更OK
    leaveSoundRef.current.volume = 0.7;
  }, []);

  // roomIdRef 同期
  useEffect(() => {
    if (sessionInfo?.roomId) roomIdRef.current = sessionInfo.roomId;
  }, [sessionInfo?.roomId]);

  // =========================
  // Socket handlers
  // =========================
  useEffect(() => {
    if (!socket) return;

    // chat.message
    const onChat = ({ from, text }) => {
      if (!isText) return; // ✅ textモード以外は無視（混線防止）
      addMessage(from === "mama" ? "mama" : "user", text);
    };

    const onEnded = ({ reason }) => {
      addMessage("system", `セッションが終了しました（理由: ${reason}）`);
      leaveVoice();
      onLeave?.();
    };

    // voice.join.ready / failed
    const onVoiceReady = (payload) => {
      if (!isVoice) return;
      setVoiceInfo(payload);
      setVoiceStatus("ready");
      addMessage("system", "🔑 音声の準備ができました。「音声に入る」を押してください。");
    };

    const onVoiceFailed = ({ message }) => {
      if (!isVoice) return;
      setVoiceStatus("failed");
      setVoiceErr(message || "voice prepare failed");
      addMessage("system", `⚠️ 音声の準備に失敗：${message || "unknown"}`);
    };

    socket.on("chat.message", onChat);
    socket.on("session.ended", onEnded);
    socket.on("voice.join.ready", onVoiceReady);
    socket.on("voice.join.failed", onVoiceFailed);

    return () => {
      socket.off("chat.message", onChat);
      socket.off("session.ended", onEnded);
      socket.off("voice.join.ready", onVoiceReady);
      socket.off("voice.join.failed", onVoiceFailed);
    };
  }, [socket, isText, isVoice, addMessage, leaveVoice, onLeave]);

  // mode切替時に初期化（壊れ防止）
  useEffect(() => {
    setMessages([]);
    setInput("");
    setTipOpen(false);
    setTipLoading(false);

    setVoiceInfo(null);
    setVoiceStatus("idle");
    setVoiceErr("");

    // voiceモードで残ってる通話があれば落とす
    return () => {
      destroyCall();
    };
  }, [mode, destroyCall]);

  // =========================
  // Actions (text mode UI)
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

  const handleCheers = () => {
    if (!isText) return; // ✅ voiceで混線させない（必要なら消してOK）
    if (cheersSoundRef.current) {
      try {
        cheersSoundRef.current.currentTime = 0;
        cheersSoundRef.current.play();
      } catch (e) {
        console.warn("cheers sound play error", e);
      }
    }

    const userText = "🍸 乾杯！";
    addMessage("user", userText);
    socket?.emit("guest.message", { text: userText });

    window.setTimeout(() => {
      if (cheersSoundRef.current) {
        try {
          cheersSoundRef.current.currentTime = 0;
          cheersSoundRef.current.play();
        } catch (e) {
          console.warn("mama cheers sound error", e);
        }
      }
      addMessage("mama", "🍸 乾杯！");
      setTipEffect(true);
      window.setTimeout(() => setTipEffect(false), 1000);
    }, 1000);
  };

  const handleConsult = () => {
    if (!isText) return;
    const text = " ちょっと相談したいことがあるんだ。";
    addMessage("user", text);
    socket?.emit("guest.message", { text });
  };

  const handleTip = () => {
    if (!isText) return;
    setTipOpen(true);
  };

  const startTipPayment = async (amount) => {
    if (!isText) return;

    const payWin = window.open("about:blank", "_blank");
    payWinRef.current = payWin;

    try {
      if (!payWin) {
        addMessage("system", "ポップアップがブロックされました。設定で許可してもう一度試してね🙏");
        return;
      }

      setTipLoading(true);

      const text = `💸 チップ ¥${amount} をはずむ。`;
      addMessage("user", text);
      socket?.emit("guest.message", { text });

      setTipEffect(true);
      socket?.emit("guest.tip", { amount });

      if (tipTimerRef.current) window.clearTimeout(tipTimerRef.current);
      tipTimerRef.current = window.setTimeout(() => setTipEffect(false), 900);

      const rid = roomIdRef.current;
      if (!rid) throw new Error("roomId missing");

      const res = await fetch(`${API_ORIGIN}/api/create-checkout-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount,
          roomId: rid,
          socketId: socket?.id,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data?.url) throw new Error(data?.error || "failed to create session");

      try {
        payWin.sessionStorage.setItem("tip_popup", "1");
      } catch {}
      try {
        payWin.name = "tip_popup";
      } catch {}

      payWin.location.replace(data.url);
    } catch (e) {
      console.error(e);
      try {
        if (payWin && !payWin.closed) payWin.close();
      } catch {}
      payWinRef.current = null;
      addMessage("system", "決済の開始に失敗しました…");
    } finally {
      setTipLoading(false);
      setTipOpen(false);
    }
  };

  // =========================
  // UI labels
  // =========================
  const voiceStatusLabel =
    voiceStatus === "idle"
      ? "未接続"
      : voiceStatus === "ready"
      ? "準備OK"
      : voiceStatus === "joining"
      ? "接続中..."
      : voiceStatus === "joined"
      ? "通話中"
      : "失敗";

  // =========================
  // Render
  // =========================
  return (
    <div className="relative min-h-screen overflow-hidden text-white bg-black">
      {/* ===== 黒下地（いちばん下） ===== */}
      <div className="absolute inset-0 bg-black" />

      {/* ===== 背景レイヤー（縮小） ===== */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: "url('/assets/session.jpg')",
          backgroundRepeat: "no-repeat",
          backgroundPosition: "center",
          backgroundSize: "cover",
          transform: "scale(0.92)", // ★ 縮小率（0.90〜0.96で調整）
          transformOrigin: "center",
        }}
      />

      {/* ===== 中身（UI） ===== */}
      <div className={"relative z-10 flex flex-col min-h-screen overflow-hidden " + (tipEffect ? "shadow-neon-pink" : "")}>
        {showCloseButton && (
          <div className="absolute top-3 right-3 z-[60]">
            <button
              type="button"
              onClick={() => window.close()}
              className="px-3 py-1 rounded-full border border-white/20 bg-black/60 text-xs text-white"
            >
              この画面を閉じる
            </button>
          </div>
        )}

        {tipEffect && (
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute bottom-4 left-1/3 w-6 h-6 rounded-full border border-yellow-300 bg-yellow-200/90 animate-coin" />
            <div className="absolute bottom-6 left-1/2 w-5 h-5 rounded-full border border-yellow-300 bg-yellow-200/80 animate-coin delay-150" />
            <div className="absolute bottom-3 left-2/3 w-4 h-4 rounded-full border border-yellow-300 bg-yellow-200/70 animate-coin delay-300" />
          </div>
        )}

        {/* 上部ビジュアル */}
        <div className="h-2/5 relative">
          <div className="absolute inset-0 bg-black/10" />
          <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-transparent to-snack-bg/40" />
          <div className="absolute bottom-4 left-4">
            <span className="bg-snack-neon-pink text-white text-xs px-2 py-1 rounded">ON AIR</span>
          </div>
        </div>

        {/* =========================
            VOICE MODE BAR
           ========================= */}
        {isVoice && (
          <div className="px-6 py-4 bg-black/40 border-y border-white/10">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs text-[#E6E0D8]">
                🎙 音声のみモード / 状態：
                <span className="text-snack-neon-blue"> {voiceStatusLabel}</span>
                <div className="text-[11px] text-white/60 mt-1">
                  ※ iPhone は「音声に入る」を押したタイミングでマイク許可が出ます
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={joinVoice}
                  disabled={voiceStatus === "joining" || voiceStatus === "joined" || !voiceInfo}
                  className="px-4 py-2 rounded-full text-xs font-semibold bg-snack-neon-blue text-black disabled:opacity-40"
                >
                  {voiceStatus === "joined" ? "入室中" : "音声に入る"}
                </button>

                <button
                  type="button"
                  onClick={leaveVoice}
                  disabled={voiceStatus !== "joined"}
                  className="px-4 py-2 rounded-full text-xs font-semibold border border-white/25 text-white/80 disabled:opacity-40"
                >
                  音声を抜ける
                </button>
              </div>
            </div>

            {!voiceInfo && (
              <div className="mt-2 text-[11px] text-yellow-200">
                音声の準備待ちです（サーバから voice.join.ready が届くまで待機）
              </div>
            )}
            {voiceErr && <div className="mt-2 text-[11px] text-red-300 whitespace-pre-wrap">{voiceErr}</div>}
          </div>
        )}

        {/* =========================
            CHAT AREA（textのみ）
           ========================= */}
        {isText && (
          <>
            <div className="flex-grow p-6 overflow-y-auto space-y-4 bg-black/30 border border-white/10 rounded-2xl mx-4 my-4">
              <div className="text-center text-xs text-gray-200 my-3">—— ママが入店しました ——</div>

              {messages.map((m) => {
                if (m.from === "system") {
                  return (
                    <div key={m.id} className="flex w-full justify-center">
                      <span className="text-[13px] text-[#E6E0D8] drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]">
                        {m.text}
                      </span>
                    </div>
                  );
                }

                const isMama = m.from === "mama";
                return (
                  <div key={m.id} className={`flex w-full ${isMama ? "justify-start" : "justify-end"}`}>
                    <div
                      className={`bubble-in max-w-[80%] px-4 py-3 rounded-2xl text-[17px] leading-[1.8] ${
                        isMama
                          ? "bg-black/45 text-[#F4EBDD] drop-shadow-[0_2px_4px_rgba(0,0,0,0.6)] rounded-tl-none"
                          : "ml-auto bg-[#f1e6d6] text-[#2b1c12] shadow-[0_4px_14px_rgba(0,0,0,0.25)] rounded-tr-none"
                      }`}
                    >
                      {m.text}
                    </div>
                  </div>
                );
              })}
            </div>

            <footer className="p-4 bg-snack-bg border-t border-snack-brown">
              <div className="flex gap-2 mb-3">
                <button
                  type="button"
                  onClick={handleCheers}
                  className="flex-1 bg-yellow-900/40 border border-yellow-600 text-yellow-200 py-2 rounded-full text-sm"
                >
                  🍸 乾杯
                </button>
                <button
                  type="button"
                  onClick={handleConsult}
                  className="flex-1 bg-snack-neon-blue/20 border border-snack-neon-blue text-snack-neon-blue py-2 rounded-full text-sm"
                >
                  相談
                </button>
                <button
                  type="button"
                  onClick={handleTip}
                  className="flex-1 bg-snack-neon-pink/10 border border-snack-neon-pink text-snack-neon-pink py-2 rounded-full text-sm"
                >
                   チップ
                </button>
              </div>

              <div className="flex justify-end mb-2">
                <button
                  type="button"
                  onClick={() => {
                    if (leaveSoundRef.current) {
                      try {
                        leaveSoundRef.current.currentTime = 0;
                        leaveSoundRef.current.play();
                      } catch (e) {
                        console.warn("leave sound play error", e);
                      }
                    }
                    window.setTimeout(() => onLeave?.(), 900);
                  }}
                  className="px-3 py-1 rounded-full border border-gray-600 text-[11px] text-gray-300 hover:bg-gray-800 transition-colors"
                >
                  もう帰る
                </button>
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="メッセージを入力..."
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="flex-grow bg-black/50 border border-snack-brown rounded-full px-4 py-2 text-sm focus:outline-none focus:border-snack-neon-pink"
                />
                <button
                  type="button"
                  onClick={handleSend}
                  className="bg-snack-neon-pink p-2 rounded-full w-10 h-10 flex items-center justify-center shadow-neon-pink active:scale-95 transition-transform"
                >
                  ▶
                </button>
              </div>
            </footer>
          </>
        )}

        {/* voiceモード：チャットUIは出さない */}
        {isVoice && (
          <div className="flex-1 flex items-center justify-center text-xs text-white/70 px-6">
            音声のみモードです。上の「音声に入る」から通話を開始してください。
          </div>
        )}

        {/* モード不明 */}
        {!isText && !isVoice && (
          <div className="p-6 text-xs text-yellow-200">
            sessionInfo.mode が不明です。サーバの session.started に mode を含めてください。
          </div>
        )}

        {/* Tip modal（textのみ） */}
        {isText && tipOpen && (
          <div className="absolute inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm p-4">
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
        )}
      </div>
    </div>
  );
};

export default SessionRoom;
