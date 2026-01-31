import React, { useCallback, useEffect, useRef, useState } from 'react';
import Daily from '@daily-co/daily-js';

const SessionRoom = ({ sessionInfo, onLeave }) => {
  // ===== Daily =====
  const callRef = useRef(null);
  const [status, setStatus] = useState('idle'); // idle | ready | joining | joined | failed
  const [errorMsg, setErrorMsg] = useState('');

  // ===== config (env or fixed) =====
  const ROOM_URL = import.meta.env.VITE_DAILY_ROOM_URL || 'https://snack-no-trace.daily.co/Snack-No-Trace'; // 例: https://xxxx.daily.co/room
  const TOKEN = import.meta.env.VITE_DAILY_TOKEN || '';       // 任意（使う場合のみ）
  const USE_TOKEN = !!TOKEN;

  const destroyCall = useCallback(async () => {
    const call = callRef.current;
    callRef.current = null;

    setStatus('idle');
    setErrorMsg('');

    if (call) {
      try {
        await call.leave();
      } catch {}
      try {
        call.destroy();
      } catch {}
    }
  }, []);

  const joinVoice = useCallback(async () => {
    setErrorMsg('');
    if (!ROOM_URL) {
      setStatus('failed');
      setErrorMsg('VITE_DAILY_ROOM_URL が未設定です（.env.local を確認してね）');
      return;
    }
    if (status === 'joining' || status === 'joined') return;

    try {
      setStatus('joining');

      const call = Daily.createCallObject({
        videoSource: false, // ✅ 音声のみ
      });
      callRef.current = call;

      call.on('joined-meeting', () => setStatus('joined'));
      call.on('left-meeting', () => setStatus('idle'));
      call.on('error', (e) => {
        console.warn('[Daily error]', e);
        setStatus('failed');
        setErrorMsg(e?.errorMsg || 'Daily error');
      });

      // ✅ iPhone重要：この joinVoice は「ボタン押下中」に呼ぶこと
      await call.join({
        url: ROOM_URL,
        videoSource: false,
      });
    } catch (e) {
      console.warn('[joinVoice] failed', e);
      setStatus('failed');
      setErrorMsg(e?.message || 'join failed');
      await destroyCall();
    }
  }, [ROOM_URL, TOKEN, USE_TOKEN, status, destroyCall]);

  const leaveVoice = useCallback(async () => {
    await destroyCall();
  }, [destroyCall]);

  // 退出時に掃除
  useEffect(() => {
    return () => {
      destroyCall();
    };
  }, [destroyCall]);

  // ===== UI labels =====
  const moodLabel =
    sessionInfo?.mood === 'relax'
      ? '癒されたい'
      : sessionInfo?.mood === 'listen'
      ? '話を聞いてほしい'
      : sessionInfo?.mood === 'advise'
      ? '悩みを相談したい'
      : 'おまかせ';

  const statusLabel =
    status === 'idle'
      ? '未接続'
      : status === 'ready'
      ? '準備OK'
      : status === 'joining'
      ? '接続中...'
      : status === 'joined'
      ? '通話中'
      : '失敗';

  return (
    <div className="min-h-[100dvh] bg-black text-white p-4">
      <div className="max-w-xl mx-auto space-y-4">
        <header className="pt-2">
          <h1 className="text-lg font-bold">Session Room</h1>
          <p className="text-xs text-white/60 mt-1">
            気分：<span className="text-white/85">{moodLabel}</span>
          </p>
        </header>

        <section className="rounded-xl border border-white/15 bg-white/5 p-4">
          <div className="flex items-center justify-between">
            <div className="text-sm">
              状態：<span className="font-semibold">{statusLabel}</span>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={joinVoice}
                disabled={status === 'joining' || status === 'joined'}
                className="px-4 py-2 rounded-full text-xs font-semibold bg-white text-black disabled:opacity-40"
              >
                音声を開始（マイク許可）
              </button>

              <button
                type="button"
                onClick={leaveVoice}
                disabled={status !== 'joined'}
                className="px-4 py-2 rounded-full text-xs font-semibold border border-white/25 text-white/80 disabled:opacity-40"
              >
                音声を抜ける
              </button>
            </div>
          </div>

          <p className="mt-2 text-[11px] text-white/55">
            ※ iPhone は「音声を開始」を押したタイミングでマイク許可が出ます
          </p>

          {errorMsg && (
            <p className="mt-2 text-[11px] text-red-300 whitespace-pre-wrap">
              {errorMsg}
            </p>
          )}

          {!ROOM_URL && (
            <p className="mt-2 text-[11px] text-yellow-200">
              VITE_DAILY_ROOM_URL が空です（env設定が必要）
            </p>
          )}
        </section>

        <section className="rounded-xl border border-white/15 bg-white/5 p-4">
          <p className="text-sm font-semibold mb-2">メモ（socket無し）</p>
          <p className="text-xs text-white/70">
            ここは今は音声専用。チャットを付けるならローカル状態 or 別の仕組みで追加できます。
          </p>
        </section>

        <div className="pt-2 flex justify-end">
          <button
            type="button"
            onClick={() => {
              leaveVoice();
              onLeave?.();
            }}
            className="px-4 py-2 rounded-md text-xs border border-white/25 text-white/70 hover:text-white/90"
          >
            セッションを終える
          </button>
        </div>
      </div>
    </div>
  );
};

export default SessionRoom;
