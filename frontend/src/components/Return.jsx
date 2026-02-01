// frontend/src/components/Return.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

export default function Return() {
  const nav = useNavigate();

  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const tip = params.get("tip"); // success / cancel
  const sessionId = params.get("session_id");
  const roomId = params.get("roomId"); // ✅ ここで取る（最上部）

  const [phase, setPhase] = useState("init"); // init -> trying_close -> fallback
  const isSuccess = tip === "success";
  const isCancel = tip === "cancel";

  const isPopup = useMemo(() => {
    try {
      if (window.name === "tip_popup") return true;
      if (window.sessionStorage.getItem("tip_popup") === "1") return true;
    } catch {}
    return false;
  }, []);

  const goBackToSession = () => {
    try {
      // ✅ 戻るための状態を保存
      if (roomId) localStorage.setItem("snack_room_id", roomId);
      localStorage.setItem("snack_step", "SESSION");
      if (sessionId) localStorage.setItem("last_checkout_session_id", sessionId);
    } catch {}

    // ✅ ルーティングがstep管理なら / に戻すのが正解
    window.location.replace("/");
  };

  useEffect(() => {
    // success/cancel 以外なら保険で戻す
    if (!isSuccess && !isCancel) {
      goBackToSession();
      return;
    }

    // ✅ 先に保存してから処理（重要）
    try {
      if (roomId) localStorage.setItem("snack_room_id", roomId);
      localStorage.setItem("snack_step", "SESSION");
      if (sessionId) localStorage.setItem("last_checkout_session_id", sessionId);
    } catch {}

    setPhase("trying_close");

    const t1 = window.setTimeout(() => {
      if (isPopup) {
        try {
          window.close();
        } catch {}
      }
    }, 600);

    const t2 = window.setTimeout(() => {
      setPhase("fallback");
      // ✅ popupじゃないなら自動で戻す（好みで）
      if (!isPopup) goBackToSession();
    }, isPopup ? 1200 : 300);

    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const title = isSuccess ? 'お支払い完了' : 'お支払いキャンセル';
  const message = isSuccess
    ? 'チップ、ありがとうございます'
    : 'お支払いはキャンセルさレました。';

  return (
    <div className="min-h-screen bg-snack-bg text-snack-text font-snack relative overflow-hidden flex items-center justify-center px-6">
      {/* ノイズ */}
      <div className="pointer-events-none absolute inset-0 bg-noise opacity-[0.06] mix-blend-overlay" />
      {/* 上下の影 */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/20 to-black/50" />

      <div className="relative z-10 w-full max-w-md rounded-2xl border border-white/10 bg-[#1c1715]/90 p-6 shadow-xl">
        <div className="text-xl mb-2 tracking-wide">{title}</div>
        <div className="text-sm text-[#E6E0D8] opacity-90 leading-relaxed">
          {message}
        </div>

        {sessionId && (
          <div className="mt-2 text-[11px] text-gray-400 break-all">
            session_id: {sessionId}
          </div>
        )}

        {/* 自動処理中 */}
        {phase === 'trying_close' && isPopup && (
          <div className="mt-5 text-xs text-gray-300">
            この画面は自動で閉じます…
          </div>
        )}

        {/* フォールバック（閉じられない/閉じない時） */}
        {phase === 'fallback' && (
          <>
            <div className="mt-5 text-xs text-gray-300 leading-relaxed">
              {isPopup ? (
                <>
                  ブラウザの仕様で自動では閉じられないことがございます。<br />
                  下のボタンで閉じるか、タブを閉じてくださいませ。
                </>
              ) : (
                <>
                  このページは決済後の案内でございます。<br />
                  下のボタンでセッション画面に戻れます。
                </>
              )}
            </div>

            <div className="mt-4 grid grid-cols-1 gap-2">
              {isPopup && (
                <button
                  type="button"
                  onClick={() => {
                    try { window.close(); } catch {}
                  }}
                  className="w-full py-3 rounded-2xl bg-black/60 border border-white/15 text-[#F4EBDD]"
                >
                  このタブを閉じる
                </button>
              )}

              <button
                type="button"
                onClick={goBackToSession}
                className="w-full py-3 rounded-2xl border border-snack-neon-pink/60 text-snack-neon-pink hover:opacity-90 transition"
              >
                セッションに戻る
              </button>
            </div>

            <div className="mt-3 text-[11px] text-gray-500">
              ※「閉じる」が効かない場合は、ブラウザのタブを手動で閉じてOK
            </div>
          </>
        )}
      </div>
    </div>
  );
}
