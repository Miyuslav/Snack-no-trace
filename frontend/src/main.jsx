import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import "./index.css";

// （任意：スマホ白画面対策・エラー可視化）
// 開発中だけ使って、安定したら消してOK
window.addEventListener("error", (e) => {
  const el = document.getElementById("fatal");
  if (el) el.textContent = String(e?.error?.stack || e?.message || e);
});
window.addEventListener("unhandledrejection", (e) => {
  const el = document.getElementById("fatal");
  if (el) el.textContent = String(e?.reason?.stack || e?.reason || e);
});

ReactDOM.createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
);
