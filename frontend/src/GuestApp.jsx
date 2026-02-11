import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import TopSelection from "./components/TopSelection.jsx";
import WaitingRoom from "./components/WaitingRoom.jsx";
import SessionRoom from "./components/SessionRoom.jsx";

import { getSocket } from "./socket.js";
import { getOrCreateGuestId } from "./utils/guestId.js";

export default function GuestApp() {
  const location = useLocation();
  const navigate = useNavigate();

  const MAMA_ROOM_ID = useMemo(
    () => import.meta.env.VITE_MAMA_ROOM_ID || "room_mama_fixed",
    []
  );

  // ✅ socket は1回だけ
  const socketRef = useRef(null);
  if (!socketRef.current) socketRef.current = getSocket("guest");
  const socket = socketRef.current;

  // ✅ guestId は1本化（固定）
  const guestIdRef = useRef(null);
  if (!guestIdRef.current) guestIdRef.current = getOrCreateGuestId();
  const guestId = guestIdRef.current;

  // mood/mode は localStorage を保険に
  const [sessionInfo, setSessionInfo] = useState(() => {
    try {
      const mood = localStorage.getItem("last_mood") || "";
      const mode = localStorage.getItem("last_mode") || "";
      return { mood, mode, voiceInfo: null, voiceError: "" };
    } catch {
      return { mood: "", mode: "", voiceInfo: null, voiceError: "" };
    }
  });

  // 🍸 入店音（iOS unlock用）
  const enterSoundRef = useRef(null);
  useEffect(() => {
    try {
      const a = new Audio("/door.mp3");
      a.volume = 0.28;
      enterSoundRef.current = a;
    } catch {}
  }, []);

  const unlockAudio = useCallback(() => {
    const a = enterSoundRef.current;
    if (!a) return;
    try {
      a.muted = true;
      a.play()
        .then(() => {
          a.pause();
          a.currentTime = 0;
          a.muted = false;
        })
        .catch(() => {});
    } catch {}
  }, []);

  // ✅ join_room（socket.id 単位で1回だけ）
  const joinedSocketIdRef = useRef(null);
  useEffect(() => {
    if (!socket) return;

    const joinOncePerSocketId = () => {
      if (!socket.id) return;
      if (joinedSocketIdRef.current === socket.id) return;
      joinedSocketIdRef.current = socket.id;

      socket.emit("join_room", { roomId: MAMA_ROOM_ID });
      console.log("[guest] join_room", socket.id, MAMA_ROOM_ID);
    };

    const onConnect = () => {
      console.log("[guest] connected", socket.id, { guestId });
      joinOncePerSocketId();
    };

    const onDisconnect = (reason) => {
      console.log("[guest] disconnected", socket.id, reason);
      joinedSocketIdRef.current = null;
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    if (socket.connected) joinOncePerSocketId();

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
    };
  }, [socket, MAMA_ROOM_ID, guestId]);

  // session started/ended → 画面遷移
  useEffect(() => {
    if (!socket) return;

    const onSessionStarted = (payload) => {
      console.log("[guest] session.started", payload);

      try {
        if (payload?.mood) localStorage.setItem("last_mood", payload.mood);
        if (payload?.mode) localStorage.setItem("last_mode", payload.mode);
      } catch {}

      setSessionInfo((prev) => ({
        ...prev,
        mood: payload?.mood ?? prev.mood,
        mode: payload?.mode ?? prev.mode,
        voiceInfo: payload?.voiceInfo ?? prev.voiceInfo ?? null,
        voiceError: payload?.voiceError ?? "",
        startedAt: payload?.startedAt ?? prev.startedAt ?? null,
        maxMs: payload?.maxMs ?? prev.maxMs ?? null,
        resumed: !!payload?.resumed,
      }));

      navigate("/session", { replace: true });
    };

    const onSessionEnded = ({ reason }) => {
      console.log("[guest] session.ended", reason);
      navigate("/", { replace: true });
    };

    socket.on("session.started", onSessionStarted);
    socket.on("session.ended", onSessionEnded);

    return () => {
      socket.off("session.started", onSessionStarted);
      socket.off("session.ended", onSessionEnded);
    };
  }, [socket, navigate]);

  const handleEnter = useCallback(
    (mood, mode) => {
      setSessionInfo({ mood, mode, voiceInfo: null, voiceError: "" });

      try {
        if (mood) localStorage.setItem("last_mood", mood);
        if (mode) localStorage.setItem("last_mode", mode);
      } catch {}

      // ✅ iOS: ここが「クリック1回」音声アンロックの根拠
      unlockAudio();

      navigate("/waiting", { replace: true });

      // ✅ ここが “必ずguestIdを送る” 固定ポイント（触らない）
      socket.emit("guest.register", {
        guestId,
        mood,
        mode,
        roomId: MAMA_ROOM_ID,
      });

      console.log("[guest] emit guest.register", { guestId, mood, mode, roomId: MAMA_ROOM_ID, socketId: socket?.id });
    },
    [guestId, MAMA_ROOM_ID, navigate, socket, unlockAudio]
  );

  const handleLeave = useCallback(() => {
    socket.emit("guest.leave");
    navigate("/", { replace: true });
  }, [socket, navigate]);

  const path = location.pathname;

  return (
    <div className="min-h-screen bg-snack-bg text-snack-text font-snack relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-noise opacity-[0.06] mix-blend-overlay" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/15 to-black/35" />

      <div className="relative max-w-md mx-auto min-h-screen border-x border-snack-panel">
        {path === "/" && <TopSelection onEnter={handleEnter} />}

        {path === "/waiting" && (
          <WaitingRoom sessionInfo={sessionInfo} onCancel={handleLeave} socket={socket} />
        )}

        {path === "/session" && (
          <SessionRoom sessionInfo={sessionInfo} onLeave={handleLeave} socket={socket} />
        )}
      </div>
    </div>
  );
}
