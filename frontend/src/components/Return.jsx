// frontend/src/components/Return.jsx
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

export default function Return() {
  const nav = useNavigate();

  useEffect(() => {
    const qs = new URLSearchParams(window.location.search);
    const tip = qs.get("tip"); // success / cancel
    const roomId = qs.get("roomId") || "";
    const sessionId = qs.get("session_id") || "";

    // ルームIDは保存（復帰用）
    if (roomId) {
      try {
        localStorage.setItem("snack_room_id", roomId);
      } catch {}
    }

    // ✅ ポップアップ決済：親に通知して、こっちは閉じる（親は生きたまま）
    if (window.opener && !window.opener.closed) {
      try {
        window.opener.postMessage(
          { type: "stripe:return", tip, roomId, sessionId },
          "*"
        );
      } catch {}
      // 少し待って閉じる（Safari対策）
      window.setTimeout(() => {
        try { window.close(); } catch {}
      }, 150);
      return;
    }

    // ✅ 同タブ決済（iPhone等）：SPAがリロードされる前提で /session へ戻す
    // ※ /room/:id には行かない
    if (tip === "success") {
      nav("/session", { replace: true });
    } else {
      nav("/", { replace: true });
    }
  }, [nav]);

  return (
    <div style={{ padding: "2rem", textAlign: "center" }}>
      <h2>決済処理中…</h2>
      <p>自動で戻ります。</p>
    </div>
  );
}
