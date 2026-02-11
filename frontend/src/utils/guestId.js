// frontend/src/utils/guestId.js

const GUEST_ID_KEY = "snack_guest_id";

/**
 * 永続 guestId を取得 or 作成
 * - 一度作ったら絶対に変えない
 * - localStorage が死んでも fallback あり
 */
export function getOrCreateGuestId() {
  try {
    const existing = localStorage.getItem(GUEST_ID_KEY);
    if (existing) return existing;

    const id =
      (crypto?.randomUUID && `guest_${crypto.randomUUID()}`) ||
      `guest_${Date.now()}_${Math.random().toString(16).slice(2)}`;

    localStorage.setItem(GUEST_ID_KEY, id);
    return id;
  } catch {
    // localStorage が使えない環境用
    return `guest_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }
}
