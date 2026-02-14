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
  const registeredRef = useRef(false);

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
  // ✅ join_room（シンプル安定版）
  useEffect(() => {
    if (!socket) return;

    const onConnect = () => {
      console.log("[guest] connected", socket.id);

      socket.emit("join_room", { roomId: MAMA_ROOM_ID });
      console.log("[guest] join_room", socket.id, MAMA_ROOM_ID);
    };

    socket.on("connect", onConnect);

    if (socket.connected) {
      socket.emit("join_room", { roomId: MAMA_ROOM_ID });
    }

    return () => {
      socket.off("connect", onConnect);
    };
  }, [socket, MAMA_ROOM_ID]);


　// 🔥 disconnect時に registerガード解除
 useEffect(() => {
   if (!socket) return;

   const onDisconnect = (reason) => {
     console.log("[guest] disconnected → reset register flag", reason);
     registeredRef.current = false;
   };

   socket.on("disconnect", onDisconnect);

   return () => {
     socket.off("disconnect", onDisconnect);
   };
 }, [socket]);

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
        hasRegisteredRef.current = false;
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

      unlockAudio();
      navigate("/waiting", { replace: true });

      if (socket?.connected) {
        socket.emit("guest.register", {
          guestId,
          mood,
          mode,
          roomId: MAMA_ROOM_ID,
        });

        console.log("🔥 guest.register", socket.id);
      } else {
        console.log("⚠️ socket not connected yet");
      }
    },
    [guestId, MAMA_ROOM_ID, navigate, socket, unlockAudio]
  );

  // ✅ waiting に入ったら必ず register（iPhone/初回接続の取りこぼし対策）
  const hasRegisteredRef = useRef(false);

  useEffect(() => {
    if (!socket) return;
    if (location.pathname !== "/waiting") return;

    const mood = sessionInfo?.mood;
    const mode = sessionInfo?.mode;
    if (!mood || !mode) return;

    const send = () => {
      if (!socket.id) return;
      if (hasRegisteredRef.current) return;

      socket.emit("guest.register", { guestId, mood, mode, roomId: MAMA_ROOM_ID });
      console.log("[guest] guest.register (waiting auto)", {
        socketId: socket.id,
        guestId,
        mood,
        mode,
        roomId: MAMA_ROOM_ID,
      });

      hasRegisteredRef.current = true;
    };

    socket.on("connect", send);
    if (socket.connected) send();

    return () => socket.off("connect", send);
  }, [socket, location.pathname, sessionInfo?.mood, sessionInfo?.mode, guestId, MAMA_ROOM_ID]);


  const handleLeave = useCallback(() => {
      hasRegisteredRef.current = false;
    socket.emit("guest.leave");
    navigate("/", { replace: true });
  }, [socket, navigate]);

  const path = location.pathname;

  return (
    <div className="min-h-[var(--app-height)] bg-snack-bg text-snack-text font-snack relative">
      <div className="pointer-events-none absolute inset-0 bg-noise opacity-[0.06] mix-blend-overlay" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/15 to-black/35" />

      <div className="relative max-w-md mx-auto min-h-[var(--app-height)] border-x border-snack-panel flex flex-col">
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
