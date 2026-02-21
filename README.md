🚀 本番運用（Fly.io）

本番環境では、バックエンドを Fly.io 上で起動・停止して運用します。

▶ 起動手順
1. アプリ名確認
   fly apps list


例：

backend-dark-violet-924

2. マシン起動
   fly scale count 1 -a backend-dark-violet-924

3. 起動確認
   fly machine list -a backend-dark-violet-924


STATE: started になっていればOK。

4. ヘルスチェック
   curl -i https://backend-dark-violet-924.fly.dev/api/health


成功例：

{"ok":true,"ts":...}

5. ログ監視（重要）
   fly logs -a backend-dark-violet-924


正常時に確認できるログ例：

[BOOT] listening on 0.0.0.0:4000
[SOCKET CONNECT]
[SESSION START]
[Daily] token created OK

■ 停止手順
fly scale count 0 -a backend-dark-violet-924


確認：

fly machine list -a backend-dark-violet-924


表示：

No machines are available on this app


※ ブラウザは自動再接続を試みるため、停止後も WebSocket failed ログが出ることがあります。正常動作です。

■ 再起動
fly scale count 1 -a backend-dark-violet-924


その後：

curl https://backend-dark-violet-924.fly.dev/api/health


HTTP 200 が返れば復旧完了。

🧪 ローカル開発
バックエンド起動
cd backend
node server.js


表示：

[BOOT] listening on 0.0.0.0:4000

フロントエンド起動
npm run dev

🌍 エンドポイント
Backend
https://backend-dark-violet-924.fly.dev

Health Check
/api/health

WebSocket
wss://backend-dark-violet-924.fly.dev/socket.io

🔐 環境変数（Fly Secrets）

確認：

fly secrets list -a backend-dark-violet-924


必要な設定：

STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
DAILY_ROOM_URL
DAILY_API_KEY
FRONTEND_ORIGIN

🛠 トラブルシュート
1. HTTPSは通るが WebSocket が失敗する
   fly machine list -a backend-dark-violet-924


マシンが 0 台になっていないか確認。

2. Daily token create failed

ログに：

Missing DAILY_ROOM_URL or DAILY_API_KEY


→ Fly Secrets 未設定。

3. WebSocket failed が止まらない

frontend/src/socket.js にて：

reconnectionAttempts: 5


に変更するとデバッグ中のログ暴走を防げます。

🔁 緊急リセット
fly scale count 0 -a backend-dark-violet-924
fly scale count 1 -a backend-dark-violet-924

🚀 backend デプロイ
fly deploy -a backend-dark-violet-924

✅ 本番チェックリスト

fly machine list → started

/api/health → 200

Mama接続 → [SOCKET CONNECT] role= mama

Guest接続 → [GUEST REGISTER]

Voice利用時 → [Daily] token created OK