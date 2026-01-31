//// frontend/src/socket.js
//import { io } from "socket.io-client";
//
//const BACKEND =
//  import.meta.env.VITE_SOCKET_URL || "http://localhost:4000";
//
//export const createSocket = (role = "guest") =>
//  io(BACKEND, {
//    transports: ["websocket", "polling"],
//    withCredentials: true,
//    auth: { role },
//    reconnection: true,
//    reconnectionAttempts: 3,
//    reconnectionDelay: 800,
//    timeout: 5000,
//  });
// frontend/src/socket.js
import { io } from "socket.io-client";

const BACKEND = import.meta.env.VITE_SOCKET_URL || "http://localhost:4000";

// roleごとに1本だけ使い回す
const sockets = new Map();

export const getSocket = (role = "guest") => {
  if (sockets.has(role)) return sockets.get(role);

  const sock = io(BACKEND, {
    transports: ["websocket", "polling"],
    withCredentials: true,

    // ✅ サーバー側が handshake.auth.role を見るならこれでOK
    auth: { role },

    reconnection: true,
    reconnectionAttempts: 3,
    reconnectionDelay: 800,
    timeout: 5000,
  });

  sockets.set(role, sock);
  return sock;
};

// 任意：明示的に切りたいとき用（ログアウトなど）
export const disconnectSocket = (role = "guest") => {
  const sock = sockets.get(role);
  if (!sock) return;
  sock.disconnect();
  sockets.delete(role);
};
