import React, { useEffect, useState, useRef } from 'react';
import { socket } from '../socket';

const ZOOM_URL =
  import.meta.env.VITE_ZOOM_URL || 'https://zoom.us/j/your-meeting-id';

const WaitingRoom = ({ sessionInfo, onCancel }) => {
  const [queueInfo, setQueueInfo] = useState(null);
  const [copied, setCopied] = useState(false);

  // ✅ useRef はコンポーネント内
  const evapSoundRef = useRef(null);

  const playEvapSoft = () => {
    if (typeof window === 'undefined' || typeof Audio === 'undefined') return;

    try {
      if (!evapSoundRef.current) {
        const a = new Audio('/door_out.mp3');
        a.preload = 'auto';
        a.volume = 0.2; // 弱め
        evapSoundRef.current = a;
      }

      const a = evapSoundRef.current;
      a.currentTime = 0;
      a.play().catch(() => {});
    } catch (e) {
      console.warn('evap sound error', e);
    }
  };

  useEffect(() => {
    const handleQueuePosition = (payload) => setQueueInfo(payload);

    socket.on('queue.position', handleQueuePosition);
    return () => socket.off('queue.position', handleQueuePosition);
  }, []);

  const handleCopyZoomUrl = async () => {
    try {
      await navigator.clipboard.writeText(ZOOM_URL);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      console.warn('copy zoom url failed', e);
    }
  };

const moodLabel =
  sessionInfo.mood === 'relax'
    ? ' 癒されたい'
    : sessionInfo.mood === 'listen'
    ? ' 話を聞いてほしい'
    : sessionInfo.mood === 'advise'
    ? ' 悩みを相談したい'
    : 'おまかせ';

const modeLabel =
  sessionInfo.mode === 'chat' ? '映像付きチャット（Zoom）' : 'テキストのみ';

  return (
    <div className="min-h-screen flex flex-col bg-snack-bg text-snack-text animate-fadeIn">
      {/* ヘッダー */}
      <header className="text-center py-8 border-b border-snack-brown/60 bg-black/30">
        <div className="inline-block relative">
          <img
                      src="/assets/logo.png"
                      alt="スナック蒸発"
                      className="
                        w-[300px] mx-auto rounded-md
                        drop-shadow-[0_0_12px_rgba(255,90,120,.35)]
                      "
                    />
          <div className="absolute inset-0 rounded-md blur-xl opacity-40 bg-snack-neon-pink/20 -z-10" />
        </div>
        <p className="mt-2 text-[13px] text-snack-neon-blue tracking-[0.25em] uppercase">
          No Trace – Waiting Lounge
        </p>
      </header>

      {/* メイン */}
      <main className="flex-1 px-6 py-6 flex flex-col gap-6">
        {/* ママ準備中 */}
        <section className="bg-black/40 border border-snack-brown/60 rounded-2xl p-4 shadow-inner">
          <p className="text-xs text-gray-400 mb-1">ステータス</p>
          <div className="flex items-center gap-3">
            <div className="relative">
              <span className="flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-snack-neon-pink opacity-50" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-snack-neon-pink" />
              </span>
            </div>
            <div>
              <p className="text-sm font-semibold">
                ママがグラスを拭きながら、あなたを迎える準備をしています…
              </p>
              <p className="text-xs text-gray-400 mt-1">
                画面はこのままで大丈夫です。そのままお待ちください。
              </p>
            </div>
          </div>
        </section>

        {/* オーダー内容 */}
        <section className="bg-snack-brown/20 border border-snack-brown/70 rounded-2xl p-4 text-sm">
          <p className="text-xs text-gray-300 mb-2">今日のオーダー内容</p>
          <div className="space-y-1">
            <div className="flex justify-between">
              <span className="text-gray-400">気分</span>
              <span className="font-semibold">{moodLabel}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">モード</span>
              <span className="font-semibold">{modeLabel}</span>
            </div>
          </div>
        </section>

        {/* 待ち人数 */}
        <section className="bg-black/40 border border-snack-brown/40 rounded-2xl p-4 text-sm">
          <p className="text-xs text-gray-300 mb-2">待ち状況</p>
          {queueInfo ? (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-lg font-mono">
                  あと{' '}
                  <span className="text-snack-neon-pink font-bold">
                    {queueInfo.position}
                  </span>{' '}
                  番目
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  （現在 {queueInfo.size} 人が待機中）
                </p>
              </div>
              <div className="text-right text-[10px] text-gray-500">
                ※実際の待ち時間は会話の長さによって前後します
              </div>
            </div>
          ) : (
            <p className="text-xs text-gray-500">
              待ち状況を取得しています…
            </p>
          )}
        </section>

        {/* Zoom案内：chat のときだけ表示（URLは出さない） */}
        {sessionInfo?.mode === 'chat' && (
          <section className="bg-black/50 border border-snack-neon-blue/60 rounded-2xl p-4 text-sm">
            <p className="text-xs text-snack-neon-blue mb-2">
              映像付きチャット（Zoom）のご案内
            </p>

            <p className="text-xs text-gray-300 mb-3">
              下のボタンから Zoom を開いて、そのままお待ちください。
            </p>

            <button
              type="button"
              onClick={() => {
                try {
                  window.open(ZOOM_URL, '_blank', 'noopener,noreferrer');
                } catch (e) {
                  console.warn('failed to open zoom url', e);
                }
              }}
              className="
                w-full py-3 rounded-full
                bg-snack-neon-blue text-black font-semibold text-xs
                hover:opacity-90 transition
              "
            >
            </button>

            <p className="mt-2 text-[10px] text-gray-400">
              ※URLは表示されません（誤共有防止）
            </p>
          </section>
        )}


                {/* もう帰るボタン */}
                <div className="mt-auto pt-4">
                  <button
                    type="button"
                    onClick={() => {
                          playEvapSoft(); // ← 追加（即）
                          setTimeout(() => onCancel(), 120);
                        }}
                    className="w-full py-3 text-xs rounded-full border border-gray-600 text-gray-300 hover:bg-gray-800 transition-colors"
                  >
                    もう帰る
                  </button>
                </div>
      </main>
    </div>
  );
};

export default WaitingRoom;
