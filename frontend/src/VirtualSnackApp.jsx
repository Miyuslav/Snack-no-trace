// frontend/src/VirtualSnackApp.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import MamaConsole from "./components/MamaConsole";

import TopSelection from "./components/TopSelection.jsx";
import WaitingRoom from "./components/WaitingRoom.jsx";
import SessionRoom from "./components/SessionRoom.jsx";

import { getSocket } from "./socket.js";

export default function VirtualSnackApp() {
  const location = useLocation();

  // ✅ まず window の search を優先（router都合で空になる事故を避ける）
  const roleParam = useMemo(() => {
    const qs = new URLSearchParams(window.location.search);
    return qs.get("role");
  }, [location.key]); // location変化で再評価

  const role = useMemo(() => {
    const saved = localStorage.getItem("snack_role") || "guest";
    const r = roleParam || saved || "guest";
    return r === "mama" ? "mama" : "guest";
  }, [roleParam]);

  useEffect(() => {
    if (roleParam) localStorage.setItem("snack_role", roleParam);
  }, [roleParam]);

  console.log("[ROLE DEBUG]", { roleParam, role, href: window.location.href });

  if (role === "mama") return <MamaConsole />;
  return <GuestApp />;
}

function GuestApp() {
  const location = useLocation();
  const navigate = useNavigate();

  const MAMA_ROOM_ID = import.meta.env.VITE_MAMA_ROOM_ID || "room_mama_fixed";
  const GUEST_ID_KEY = "snack_guest_id";

  // ✅ guestId を必ず用意（再接続・決済紐付けのため）
  const getOrCreateGuestId = () => {
   try {
    const existing = localStorage.getItem(GUEST_ID_KEY);
    if (existing) return existing;

    const id = `guest_${crypto.randomUUID()}`;
    localStorage.setItem(GUEST_ID_KEY, id);
    return id;
  } catch {
    return `guest_${crypto.randomUUID()}`;
  }
};

  // ✅ 1回だけ
  const socketRef = useRef(null);
  if (!socketRef.current) socketRef.current = getSocket("guest");
  const socket = socketRef.current;

  const [sessionInfo, setSessionInfo] = useState(() => {
    try {
      return {
        mood: localStorage.getItem("last_mood") || "",
        mode: localStorage.getItem("last_mode") || "",
      };
    } catch {
      return { mood: "", mode: "" };
    }
  });

  // ✅ join は “connect毎に1回”
  const joinedSocketIdRef = useRef(null);
  useEffect(() => {
    if (!socket) return;

    const joinOnce = () => {
      if (!socket.id) return;
      if (joinedSocketIdRef.current === socket.id) return;
      joinedSocketIdRef.current = socket.id;

      socket.emit("join_room", { roomId: MAMA_ROOM_ID });
      console.log("[guest] join_room", socket.id, MAMA_ROOM_ID);
    };

    const onConnect = () => joinOnce();
    const onDisconnect = () => (joinedSocketIdRef.current = null);

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    if (socket.connected) joinOnce();

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
    };
  }, [socket, MAMA_ROOM_ID]);

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
        voiceInfo: payload?.voiceInfo || null, // ✅ voiceInfo を受け取るならここで保持
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

  const handleEnter = (mood, mode) => {
    setSessionInfo({ mood, mode });

    try {
      if (mood) localStorage.setItem("last_mood", mood);
      if (mode) localStorage.setItem("last_mode", mode);
    } catch {}

    const guestId = getOrCreateGuestId();

    socket.emit("guest.register", {
      guestId,
      mood,
      mode,
      roomId: MAMA_ROOM_ID, // 固定部屋でOK
    });

    navigate("/waiting", { replace: true });
  };

  const handleLeave = () => {
    socket.emit("guest.leave");
    navigate("/", { replace: true });
  };

  const path = location.pathname;

  return (
    <div className="min-h-screen bg-snack-bg text-snack-text font-snack relative overflow-hidden">
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
f