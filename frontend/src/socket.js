// frontend/src/socket.js
import { io } from "socket.io-client";

function getRole() {
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get("role") === "mama" ? "mama" : "guest";
  } catch {
    return "guest";
  }
}

const SOCKET_ORIGIN =
  import.meta.env.VITE_SOCKET_URL ||
  `${window.location.protocol}//${window.location.hostname}:4000`;

export const socket = io(SOCKET_ORIGIN, {
  query: { role: getRole() },

  // ✅ websocket優先→失敗したらpolling
  transports: ["polling"],

  // ✅ 切断時の復帰を強くする
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 500,
  reconnectionDelayMax: 3000,

  // ✅ タイムアウトを少し伸ばす（polling時の不安定対策）
  timeout: 20000,

  withCredentials: false,
});

socket.on("connect", () => {
  console.log("[socket] connected", socket.id, "origin=", SOCKET_ORIGIN, "role=", socket.io.opts.query?.role);
});

socket.on("disconnect", (reason) => {
  console.warn("[socket] disconnected:", reason);
});

socket.on("connect_error", (err) => {
  console.warn("[socket] connect_error:", err?.message || err);
});

