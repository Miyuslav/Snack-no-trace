// frontend/src/socket.js
import { io } from "socket.io-client";

const BACKEND =
  import.meta.env.VITE_SOCKET_URL ||
  `${window.location.protocol}//${window.location.hostname}:4000`;

const cache = new Map();

export function getSocket(role) {
  if (cache.has(role)) return cache.get(role);

  const s = io(BACKEND, {
    path: "/socket.io",
    transports: role === "mama" ? ["websocket"] : ["websocket", "polling"],
    withCredentials: true,
    auth: { role },
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 500,
    reconnectionDelayMax: 4000,
    timeout: 20000,
    autoConnect: true,
  });

  cache.set(role, s);
  return s;
}
