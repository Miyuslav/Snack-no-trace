// frontend/src/socket.js
import { io } from "socket.io-client";

const sockets = new Map();

export const getSocket = (role = "guest") => {
  if (sockets.has(role)) return sockets.get(role);

  const sock = io(window.location.origin, {
    path: "/socket.io",
    transports: ["polling", "websocket"], // まずは安定優先
    withCredentials: true,
    auth: { role },
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 800,
    timeout: 20000,
  });

  // デバッグ（どこに繋いでるか固定確認）
  sock.on("connect", () =>
    console.log("[socket] connected", { id: sock.id, uri: sock.io.uri })
  );
  sock.on("connect_error", (e) =>
    console.warn("[socket] connect_error", e?.message)
  );

  sockets.set(role, sock);
  return sock;
};


export const disconnectSocket = (role = "guest") => {
  const sock = sockets.get(role);
  if (!sock) return;
  sock.disconnect();
  sockets.delete(role);
};
