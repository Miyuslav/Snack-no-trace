// frontend/src/socket.js
import { io } from "socket.io-client";

const params = new URLSearchParams(window.location.search);
const roleParam = params.get("role");
const role = roleParam === "mama" ? "mama" : "guest";

export const socket = io("http://localhost:4000", {
  query: { role },
  transports: ["websocket"],
});
