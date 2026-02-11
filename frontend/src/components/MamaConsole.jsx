// frontend/src/components/MamaConsole.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSocket } from "../socket.js";

const moodLabelMap = {
  relax: "癒されたい",
  listen: "話を聞いてほしい",
  advise: "悩みを相談したい",
};

const modeLabelMap = {
  text: "テキスト",
  voice: "音声",
};

export default function MamaConsole() {
  // ✅ 固定ママ部屋ID（.env で上書き可）
  const MAMA_ROOM_ID = import.meta.env.VITE_MAMA_ROOM_ID || "room_mama_fixed";

  // ✅ socket は1回だけ
  const sock = useMemo(() => getSocket("mama"), []);

  // =========================
  // State
  // =========================
  const [queue, setQueue] = useState([]);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");

  const [currentGuest, setCurrentGuest] = useState(null); // { guestSocketId, mood, mode, roomId, startedAt, maxMs }
  const [remainingMs, setRemainingMs] = useState(null);

  const [tipFlash, setTipFlash] = useState(false);
  const tipSoundRef = useRef(null);

  // ===== Voice (Daily) =====
  const callRef = useRef(null);
  const [voiceStatus, setVoiceStatus] = useState("idle"); // idle | ready | joining | joined | failed
  const [voiceInfo, setVoiceInfo] = useState(null); // { roomUrl, token, guestSocketId? }
  const [voiceErr, setVoiceErr] = useState("");

  const joinedSocketIdRef = useRef(null);

  // =========================
  // Helpers
  // =========================
  const addMessage = useCallback((from, text) => {
    if (!text) return;
    setMessages((prev) => [...prev, { id: prev.length + 1, from, text }]);
  }, []);

  const isVoiceMode = currentGuest?.mode === "voice";
  const isInVoice = voiceStatus === "joined";

  const computeRemaining = useCallback((startedAt, maxMs) => {
    if (!startedAt || !maxMs) return null;
    const endAt = Number(startedAt) + Number(maxMs);
    return Math.max(0, endAt - Date.now());
  }, []);

  // =========================
  // Tip sound
  // =========================
  useEffect(() => {
    try {
      const a = new Audio("/kanpai.mp3");
      a.volume = 0.45;
      tipSoundRef.current = a;
    } catch {}
  }, []);

  // =========================
  // Join fixed room (mama)
  // =========================
  useEffect(() => {
    if (!sock) return;

    const joinOncePerSocketId = () => {
      if (!sock.id) return;
      if (joinedSocketIdRef.current === sock.id) return; // ✅ 同一接続では1回だけ
      joinedSocketIdRef.current = sock.id;

      sock.emit("join_room", { roomId: MAMA_ROOM_ID });
      console.log("[mama] join_room", sock.id, MAMA_ROOM_ID);
    };

    const onConnect = () => joinOncePerSocketId();
    const onDisconnect = () => {
      joinedSocketIdRef.current = null; // 次の接続で join できるように
    };

    sock.on("connect", onConnect);
    sock.on("disconnect", onDisconnect);

    if (sock.connected) joinOncePerSocketId();

    return () => {
      sock.off("connect", onConnect);
      sock.off("disconnect", onDisconnect);
    };
  }, [sock, MAMA_ROOM_ID]);

  // =========================
  // Daily: destroy/leave/join
  // =========================
  const destroyCall = useCallback(async () => {
    const call = callRef.current;
    callRef.current = null;

    setVoiceStatus("idle");
    setVoiceInfo(null);
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

  const leaveVoice = useCallback(async () => {
    addMessage("system", "🔇 音声ルームから退出しました");
    await destroyCall();
  }, [destroyCall, addMessage]);

  const joinVoice = useCallback(
    async (info) => {
      const payload = info || voiceInfo;
      setVoiceErr("");

      if (!payload?.roomUrl) {
        setVoiceStatus("failed");
        setVoiceErr("roomUrl がありません（voiceInfo / voice.join.ready を待ってください）");
        return;
      }
      if (voiceStatus === "joining" || voiceStatus === "joined") return;

      try {
        setVoiceStatus("joining");

        const { default: Daily } = await import("@daily-co/daily-js");
        const call = Daily.createCallObject({ videoSource: false });
        callRef.current = call;

        call.on("joined-meeting", (e) => {
          console.log("[Daily] joined-meeting", e);
          setVoiceStatus("joined");
          try {
            call.setLocalAudio(true);
          } catch {}
        });

        call.on("left-meeting", (e) => {
          console.log("[Daily] left-meeting", e);
          setVoiceStatus("idle");
        });

        call.on("error", (e) => {
          console.warn("[Daily error]", e);
          setVoiceStatus("failed");
          setVoiceErr(e?.errorMsg || e?.message || "Daily error");
        });

        await call.join({
          url: payload.roomUrl,
          token: payload.token || undefined,
          videoSource: false,
        });

        try {
          await call.setLocalAudio(true);
        } catch {}
        try {
          await call.startLocalAudio?.();
        } catch {}

        addMessage("system", "🔊 音声ルームに入りました（ママ）");
      } catch (e) {
        console.warn("[joinVoice] failed", e);
        setVoiceStatus("failed");
        setVoiceErr(e?.message || "join failed");
        await destroyCall();
        addMessage("system", "⚠️ 音声ルームに入れませんでした");
      }
    },
    [voiceInfo, voiceStatus, destroyCall, addMessage]
  );

  const requestVoiceJoin = useCallback(() => {
    setVoiceErr("");
    setVoiceStatus("joining");
    sock.emit("voice.join.request");
    addMessage("system", "🔑 音声トークンの再送をリクエストしました…");
  }, [sock, addMessage]);

  // =========================
  // Socket event handlers (1本化)
  // =========================
  useEffect(() => {
    if (!sock) return;

    // --- connection
    const onConnect = () => addMessage("system", `✅ 接続しました（mama） id=${sock.id}`);
    const onDisconnect = (reason) => addMessage("system", `⚠️ 切断しました（${reason || "unknown"}）`);
    const onConnectError = (err) =>
      addMessage("system", `⚠️ 接続エラー: ${err?.message || "unknown"}`);

    // --- queue/chat
    const onQueueUpdate = (list) => setQueue(Array.isArray(list) ? list : []);
    const onNotify = () => addMessage("system", "🆕 新しいお客さんが入店しました。");
    const onChatMessage = ({ from, text }) => addMessage(from === "guest" ? "guest" : "mama", text);
    const onSystemMessage = ({ text }) => text && addMessage("system", text);

    // --- session
    const onSessionStarted = (payload = {}) => {
      // payload: { guestSocketId, mood, mode, roomId, startedAt, maxMs, resumed, voiceInfo? }
      const guestSocketId = payload.guestSocketId || payload.guestSocketID || null;
      const mood = payload.mood ?? null;
      const mode = payload.mode ?? null;

      setCurrentGuest({
        guestSocketId,
        mood,
        mode,
        roomId: payload.roomId ?? null,
        startedAt: payload.startedAt ?? null,
        maxMs: payload.maxMs ?? null,
      });

      setRemainingMs(computeRemaining(payload.startedAt, payload.maxMs));

      addMessage(
        "system",
        `🍸 セッション開始：${moodLabelMap[mood] ?? "（気分未設定）"} / ${
          modeLabelMap[mode] ?? "未設定"
        }${payload.resumed ? "（復帰）" : ""}`
      );

      // ✅ voiceInfo が一緒に来たら保持（方針A）
      if (payload.voiceInfo?.roomUrl) {
        setVoiceInfo(payload.voiceInfo);
        setVoiceStatus("ready");
        setVoiceErr("");
      } else {
        // voice なのに無い時は「準備待ち」
        if (mode === "voice") {
          setVoiceInfo(null);
          setVoiceStatus("idle");
          if (payload.voiceError) {
            setVoiceStatus("failed");
            setVoiceErr(payload.voiceError);
          } else {
            setVoiceErr("");
          }
        } else {
          // text の時は voice を掃除
          setVoiceInfo(null);
          setVoiceStatus("idle");
          setVoiceErr("");
        }
      }

      // セッション切替で通話が残ってたら掃除（安全）
      destroyCall();
    };

    const onSessionEnded = ({ reason } = {}) => {
      addMessage("system", `⏹ セッション終了（理由: ${reason || "unknown"}）`);
      setCurrentGuest(null);
      setRemainingMs(null);
      destroyCall();
    };

    const onSessionWarning = () => {
      addMessage("system", "⏳ まもなくセッション終了です（残り1分）");
    };

    // --- voice
    const onVoiceReady = (payload = {}) => {
      // payload: { guestSocketId?, roomUrl, token, resumed? }
      if (payload?.roomUrl) {
        setVoiceInfo({ roomUrl: payload.roomUrl, token: payload.token, guestSocketId: payload.guestSocketId });
        setVoiceStatus("ready");
        setVoiceErr("");
        addMessage("system", "🎙 音声の準備ができました");
      } else {
        setVoiceStatus("failed");
        setVoiceErr("voice.join.ready に roomUrl がありません");
      }
    };

    const onVoiceFailed = ({ message } = {}) => {
      setVoiceStatus("failed");
      setVoiceErr(message || "音声の準備に失敗しました");
      addMessage("system", `⚠️ 音声準備失敗: ${message || "unknown"}`);
    };

    // --- tip
    const onGuestTip = ({ amount } = {}) => {
      addMessage("system", `💸 ゲストがチップ準備（¥${amount ?? "?"}）`);
    };

    const onTipConfirmed = ({ amount } = {}) => {
      setTipFlash(true);
      try {
        if (tipSoundRef.current) {
          tipSoundRef.current.currentTime = 0;
          tipSoundRef.current.play();
        }
      } catch {}
      window.setTimeout(() => setTipFlash(false), 900);

      addMessage("system", `✅ チップ支払い確定（¥${amount ?? "?"}）🍺`);
    };

    // register
    sock.on("connect", onConnect);
    sock.on("disconnect", onDisconnect);
    sock.on("connect_error", onConnectError);

    sock.on("queue.update", onQueueUpdate);
    sock.on("mama.notify", onNotify);
    sock.on("chat.message", onChatMessage);
    sock.on("system_message", onSystemMessage);

    sock.on("session.started", onSessionStarted);
    sock.on("session.ended", onSessionEnded);
    sock.on("session.warning", onSessionWarning);

    sock.on("voice.join.ready", onVoiceReady);
    sock.on("voice.join.failed", onVoiceFailed);

    sock.on("guest.tip", onGuestTip);
    sock.on("tip.confirmed", onTipConfirmed);

    return () => {
      sock.off("connect", onConnect);
      sock.off("disconnect", onDisconnect);
      sock.off("connect_error", onConnectError);

      sock.off("queue.update", onQueueUpdate);
      sock.off("mama.notify", onNotify);
      sock.off("chat.message", onChatMessage);
      sock.off("system_message", onSystemMessage);

      sock.off("session.started", onSessionStarted);
      sock.off("session.ended", onSessionEnded);
      sock.off("session.warning", onSessionWarning);

      sock.off("voice.join.ready", onVoiceReady);
      sock.off("voice.join.failed", onVoiceFailed);

      sock.off("guest.tip", onGuestTip);
      sock.off("tip.confirmed", onTipConfirmed);
    };
  }, [sock, addMessage, computeRemaining, destroyCall]);

  // =========================
  // Timer (remainingMs)
  // =========================
  useEffect(() => {
    if (remainingMs == null) return;
    if (remainingMs <= 0) return;

    const t = setInterval(() => {
      setRemainingMs((ms) => (ms == null ? null : Math.max(0, ms - 1000)));
    }, 1000);
    return () => clearInterval(t);
  }, [remainingMs]);

  // =========================
  // Actions
  // =========================
  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    sock.emit("mama.message", { text });
    addMessage("mama", text);
    setInput("");
  }, [sock, input, addMessage]);

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

  // =========================
  // UI
  // =========================
  return (
    <div className="min-h-screen bg-snack-bg text-snack-text font-snack">
      <header className="p-4 border-b border-snack-brown bg-black/40">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold">🍸 Mama Console</div>
            <div className="text-[11px] text-gray-400">role=mama</div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleEndSession}
              disabled={!currentGuest}
              className="px-3 py-1 rounded-full text-xs border border-gray-500 text-gray-200 disabled:opacity-40"
            >
              セッション終了
            </button>
          </div>
        </div>
      </header>

      {/* 状態バー */}
      <div
        className={[
          "p-4 border-b border-snack-brown text-xs bg-black/30 flex justify-between items-center",
          tipFlash ? "animate-pulse" : "",
        ].join(" ")}
      >
        <div>
          {currentGuest ? (
            <>
              <span className="font-semibold">会話中のゲスト</span>{" "}
              <span className="text-gray-300">
                {moodLabelMap[currentGuest.mood] ?? "（気分未設定）"} /{" "}
                {modeLabelMap[currentGuest.mode] ?? "未設定"}
              </span>

              {isVoiceMode && (
                <span className="ml-2 text-[10px] text-snack-neon-blue">
                  （音声: {voiceStatus}
                  {voiceErr ? ` / ${voiceErr}` : ""}）
                </span>
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

      {/* Voice controls（音声モード時のみ表示） */}
      {isVoiceMode && (
        <div className="p-3 border-b border-snack-brown bg-black/20 flex items-center justify-between gap-2">
          <div className="text-[11px] text-gray-300">
            音声のみセッションです。必要なときだけ入室してください。
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!currentGuest || voiceStatus === "joining" || isInVoice}
              onClick={() => {
                // voiceInfo が無ければ保険で request
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
              退出
            </button>
          </div>
        </div>
      )}

      <main className="grid grid-cols-1 md:grid-cols-2 gap-0">
        {/* Queue */}
        <section className="p-4 border-b md:border-b-0 md:border-r border-snack-brown">
          <div className="text-sm font-semibold mb-3">待機中キュー</div>

          {queue.length === 0 ? (
            <div className="text-xs text-gray-500">待機中のお客さんはいません。</div>
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
                    <div className="text-gray-400">
                      モード: {modeLabelMap[g.mode] ?? "未設定"}
                    </div>
                    <div className="text-[10px] text-gray-500 break-all">{g.socketId}</div>
                  </div>

                  <button
                    type="button"
                    className="px-3 py-1 rounded-full text-xs bg-snack-neon-blue text-black font-semibold"
                    onClick={() => handleAccept(g.socketId)}
                  >
                    迎える
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Chat */}
        <section className="p-4 flex flex-col min-h-[60vh]">
          <div className="text-sm font-semibold mb-3">会話ログ</div>

          <div className="flex-1 overflow-auto space-y-2 bg-black/20 rounded-lg p-3 border border-snack-brown">
            {messages.length === 0 ? (
              <div className="text-xs text-gray-500">まだメッセージはありません。</div>
            ) : (
              messages.map((m) => (
                <div key={m.id} className="text-xs">
                  <span className="text-gray-400 mr-2">[{m.from}]</span>
                  <span className="text-gray-100">{m.text}</span>
                </div>
              ))
            )}
          </div>

          <div className="mt-3 flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={!currentGuest}
              placeholder={currentGuest ? "メッセージを入力…" : "セッション開始後に入力できます"}
              className="flex-1 px-3 py-2 rounded-lg bg-black/30 border border-snack-brown text-sm outline-none disabled:opacity-40"
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={!currentGuest}
              className="px-4 py-2 rounded-lg bg-snack-neon-pink text-black font-semibold text-sm disabled:opacity-40"
            >
              送信
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}
