// frontend/src/components/MamaConsole.jsx
import React, { useState, useEffect, useRef, useMemo } from "react";
import { getSocket } from "../socket";

const moodLabelMap = {
  relax: "🌸 癒されたい",
  listen: "💬 話を聞いてほしい",
  advise: "🤔 悩みを相談したい",
};

const modeLabelMap = {
  text: "テキストのみ",
  voice: "音声のみ",
};

const MamaConsole = () => {
  const sock = useMemo(() => getSocket("mama"), []);

  // =========================
  // State
  // =========================
  const [queue, setQueue] = useState([]);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [currentGuest, setCurrentGuest] = useState(null);
  const [remainingMs, setRemainingMs] = useState(null);

  const [tipFlash, setTipFlash] = useState(false);
  const tipSoundRef = useRef(null);

  // ===== Voice (Daily) =====
  const callRef = useRef(null);
  const [voiceStatus, setVoiceStatus] = useState("idle"); // idle | ready | joining | joined | failed
  const [voiceInfo, setVoiceInfo] = useState(null); // { roomUrl, token, resumed? }

  const addMessage = (from, text) => {
    setMessages((prev) => [...prev, { id: prev.length + 1, from, text }]);
  };

  useEffect(() => {
    // auth: { role:"mama" } を送っているので基本不要だけど、
    // サーバ側が role.set を使う運用なら残してOK
    sock.emit("role.set", { role: "mama" });
  }, [sock]);

  // チップ音（ママ側だけ）
  useEffect(() => {
    if (typeof window === "undefined" || typeof Audio === "undefined") return;
    tipSoundRef.current = new Audio("/Cash.mp3");
  }, []);

  // ===== Daily helper =====
  const destroyCall = async () => {
    try {
      const call = callRef.current;
      callRef.current = null;
      setVoiceInfo(null);
      setVoiceStatus("idle");
      if (call) {
        try {
          await call.leave();
        } catch {}
        call.destroy();
      }
    } catch {}
  };

  const joinVoice = async ({ roomUrl, token, resumed }) => {
    if (voiceStatus === "joined") return;

    setVoiceStatus("joining");
    setVoiceInfo({ roomUrl, token, resumed: !!resumed });

    try {
      // ✅ Daily は必要なときだけロード（初期ロード軽量化）
      const { default: Daily } = await import("@daily-co/daily-js");

      const call = Daily.createCallObject({ videoSource: false });
      callRef.current = call;

      call.on("joined-meeting", () => setVoiceStatus("joined"));
      call.on("left-meeting", () => setVoiceStatus("idle"));
      call.on("error", (e) => {
        console.warn("[Daily error]", e);
        setVoiceStatus("failed");
      });

      await call.join({ url: roomUrl, token });
      addMessage("system", "🔊 音声ルームに入りました（ママ）");
    } catch (e) {
      console.warn("[joinVoice] failed", e);
      setVoiceStatus("failed");
      addMessage("system", "⚠️ 音声ルームに入れませんでした");
      await destroyCall();
    }
  };

  const requestVoiceJoin = () => {
    if (!currentGuest || currentGuest.mode !== "voice") return;
    if (voiceStatus === "joining" || voiceStatus === "joined") return;
    setVoiceStatus("joining");
    sock.emit("voice.join.request");
  };

  const leaveVoice = async () => {
    addMessage("system", "🔇 音声ルームから退出しました（ママ）");
    await destroyCall();
  };

  // =========================
  // Socket handlers
  // =========================
  useEffect(() => {
    const onQueueUpdate = (list) => setQueue(Array.isArray(list) ? list : []);
    const onNotify = () => addMessage("system", "新しいお客さんが入店しました。");

    const onChatMessage = ({ from, text }) => {
      addMessage(from === "guest" ? "guest" : "mama", text);
    };

    const onSessionStarted = (payload) => {
      setCurrentGuest({
        socketId: payload.guestSocketId,
        mood: payload.mood,
        mode: payload.mode,
      });
      setMessages([]);
      setRemainingMs(payload.maxMs || null);

      setVoiceInfo(null);
      setVoiceStatus("idle");

      addMessage("system", "セッションが開始しました。（最大10分）");
      if (payload.mode === "voice") {
        addMessage("system", "🔊 音声のみモードです。「音声の準備」→「音声に入る」を押してください。");
      }
    };

    const onSessionEnded = ({ reason }) => {
      addMessage("system", `セッションが終了しました。（理由: ${reason}）`);
      setCurrentGuest(null);
      setRemainingMs(null);
      // 音声は確実に落とす
      leaveVoice();
    };

    const onWarning = () => {
      addMessage("system", "⏰ お客さんとのセッションはあと1分で終了します。");
    };

    const onGuestTip = () => {
      setTipFlash(true);
      addMessage("system", "💸 お客さんからチップが届きました。");

      if (tipSoundRef.current) {
        try {
          tipSoundRef.current.currentTime = 0;
          tipSoundRef.current.play();
        } catch (e) {
          console.warn("tip sound play error", e);
        }
      }
      setTimeout(() => setTipFlash(false), 900);
    };

    // ✅ Voice events：サーバと統一（voice.join.*）
    const onVoiceReady = (payload) => {
      setVoiceStatus("ready");
      setVoiceInfo(payload);
      addMessage("system", "🔑 音声の準備ができました。「音声に入る」で開始できます。");
    };
    const onVoiceDenied = ({ reason }) => {
      setVoiceStatus("failed");
      addMessage("system", `⚠️ 音声参加できません（${reason}）`);
    };
    const onVoiceFailed = ({ message }) => {
      setVoiceStatus("failed");
      addMessage("system", `⚠️ 音声の準備に失敗：${message || "unknown"}`);
    };

    // 接続ログ（1箇所に統一）
    const onConnect = () => addMessage("system", `✅ 接続しました（mama） id=${sock.id}`);
    const onDisconnect = (reason) => addMessage("system", `⚠️ 切断しました（${reason}）`);
    const onConnectError = (err) =>
      addMessage("system", `⚠️ 接続エラー: ${err?.message || "unknown"}`);

    sock.on("connect", onConnect);
    sock.on("disconnect", onDisconnect);
    sock.on("connect_error", onConnectError);

    sock.on("queue.update", onQueueUpdate);
    sock.on("mama.notify", onNotify);
    sock.on("chat.message", onChatMessage);
    sock.on("session.started", onSessionStarted);
    sock.on("session.ended", onSessionEnded);
    sock.on("session.warning", onWarning);
    sock.on("guest.tip", onGuestTip);

    sock.on("voice.join.ready", onVoiceReady);
    sock.on("voice.join.denied", onVoiceDenied);
    sock.on("voice.join.failed", onVoiceFailed);

    return () => {
      sock.off("connect", onConnect);
      sock.off("disconnect", onDisconnect);
      sock.off("connect_error", onConnectError);

      sock.off("queue.update", onQueueUpdate);
      sock.off("mama.notify", onNotify);
      sock.off("chat.message", onChatMessage);
      sock.off("session.started", onSessionStarted);
      sock.off("session.ended", onSessionEnded);
      sock.off("session.warning", onWarning);
      sock.off("guest.tip", onGuestTip);

      sock.off("voice.join.ready", onVoiceReady);
      sock.off("voice.join.denied", onVoiceDenied);
      sock.off("voice.join.failed", onVoiceFailed);

      // ✅ ここでdisconnectしない（画面遷移で再接続ループを作りやすい）
    };
  }, [sock, voiceStatus]);

  // =========================
  // Timer
  // =========================
  useEffect(() => {
    if (!remainingMs) return;
    const timer = setInterval(() => {
      setRemainingMs((prev) => (prev ? Math.max(prev - 1000, 0) : null));
    }, 1000);
    return () => clearInterval(timer);
  }, [remainingMs]);

  // =========================
  // Actions
  // =========================
  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    addMessage("mama", trimmed);
    setInput("");
    sock.emit("mama.message", { text: trimmed });
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSend();
    }
  };

  const handleAccept = (guestSocketId) => {
    sock.emit("mama.acceptGuest", { guestSocketId });
  };

  const handleEndSession = () => {
    sock.emit("mama.endSession");
  };

  const minutes = remainingMs != null ? Math.floor(remainingMs / 60000) : null;
  const seconds = remainingMs != null ? Math.floor((remainingMs % 60000) / 1000) : null;

  const isVoiceMode = currentGuest?.mode === "voice";
  const isInVoice = voiceStatus === "joined";

  return (
    <div className="min-h-screen bg-snack-bg text-snack-text flex flex-col max-w-3xl mx-auto">
      <header
        className={
          "p-4 border-b border-snack-brown flex justify-between items-center " +
          (tipFlash ? "shadow-neon-pink" : "")
        }
      >
        <div>
          <h1 className="text-lg font-bold">ママ用コンソール</h1>
          <p className="text-xs text-gray-400">Virtual Snack / 待機リスト & チャット</p>
        </div>
        <span className="text-xs bg-snack-neon-pink text-black px-2 py-1 rounded-full">ONLINE</span>
      </header>

      <section className="p-4 border-b border-snack-brown text-sm bg-snack-brown/20">
        <h2 className="text-xs text-gray-300 mb-2">待機中のお客さん</h2>
        {queue.length === 0 ? (
          <p className="text-gray-500 text-xs">現在待機中のお客さんはいません。</p>
        ) : (
          <ul className="space-y-2">
            {queue.map((g, index) => (
              <li
                key={g.socketId}
                className="flex items-center justify-between bg-black/30 px-3 py-2 rounded-lg"
              >
                <div className="text-xs">
                  <div className="font-semibold">
                    #{index + 1} {moodLabelMap[g.mood] ?? "（気分未設定）"}
                  </div>
                  <div className="text-gray-400">モード: {modeLabelMap[g.mode] ?? "未設定"}</div>
                </div>
                <button
                  type="button"
                  className="px-3 py-1 rounded-full text-xs bg-snack-neon-blue text-black font-semibold"
                  onClick={() => handleAccept(g.socketId)}
                >
                  入店させる
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <main className="flex-1 flex flex-col">
        <div className="p-4 border-b border-snack-brown text-xs bg-black/40 flex justify-between items-center">
          <div>
            {currentGuest ? (
              <>
                <span className="font-semibold">会話中のゲスト</span>{" "}
                <span className="text-gray-300">
                  {moodLabelMap[currentGuest.mood]} / {modeLabelMap[currentGuest.mode]}
                </span>
                {isVoiceMode && (
                  <span className="ml-2 text-[10px] text-snack-neon-blue">（音声: {voiceStatus}）</span>
                )}
              </>
            ) : (
              <span className="text-gray-500">まだ誰とも会話していません。</span>
            )}
          </div>

          {remainingMs != null && (
            <div className="text-snack-neon-pink font-mono">
              残り {minutes}:{String(seconds).padStart(2, "0")}
            </div>
          )}
        </div>

        {isVoiceMode && (
          <div className="p-3 border-b border-snack-brown bg-black/30 flex items-center justify-between gap-2">
            <div className="text-[11px] text-gray-300">
              音声のみセッションです。必要なときだけ入室してください（事故防止）。
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={!currentGuest || voiceStatus === "joining" || isInVoice}
                onClick={() => {
                  if (!voiceInfo) requestVoiceJoin();
                  else joinVoice(voiceInfo);
                }}
                className="px-3 py-1 rounded-full text-xs bg-snack-neon-blue text-black font-semibold disabled:opacity-40"
              >
                {isInVoice ? "入室中" : voiceInfo ? "音声に入る" : "音声の準備"}
              </button>

              <button
                type="button"
                disabled={!isInVoice}
                onClick={leaveVoice}
                className="px-3 py-1 rounded-full text-xs border border-gray-500 text-gray-200 disabled:opacity-40"
              >
                音声を抜ける
              </button>
            </div>
          </div>
        )}

        <div className="flex-1 p-4 overflow-y-auto space-y-3 bg-snack-bg">
          {messages.map((m) => (
            <div
              key={m.id}
              className={`flex ${
                m.from === "guest" ? "justify-start" : m.from === "mama" ? "justify-end" : "justify-center"
              }`}
            >
              {m.from === "system" ? (
                <span className="text-xs text-gray-500">{m.text}</span>
              ) : (
                <div
                  className={`max-w-[80%] p-3 rounded-2xl text-sm leading-relaxed ${
                    m.from === "guest"
                      ? "bg-snack-brown text-snack-text rounded-tl-none"
                      : "bg-snack-neon-blue text-black rounded-tr-none"
                  }`}
                >
                  {m.text}
                </div>
              )}
            </div>
          ))}
        </div>

        <footer className="p-4 border-t border-snack-brown bg-snack-bg">
          <div className="flex gap-2 mb-2">
            <button
              type="button"
              onClick={handleEndSession}
              disabled={!currentGuest}
              className="px-3 py-1 rounded-full text-xs border border-gray-500 text-gray-300 disabled:opacity-40"
            >
              セッション終了
            </button>
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              placeholder="お客さんへのメッセージを入力..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              className="flex-grow bg-black/50 border border-snack-brown rounded-full px-4 py-2 text-sm focus:outline-none focus:border-snack-neon-pink"
              disabled={!currentGuest}
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={!currentGuest}
              className="bg-snack-neon-pink p-2 rounded-full w-10 h-10 flex items-center justify-center shadow-neon-pink active:scale-95 transition-transform disabled:opacity-40"
            >
              ▶
            </button>
          </div>
        </footer>
      </main>
    </div>
  );
};

export default MamaConsole;
