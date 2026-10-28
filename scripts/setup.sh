#!/usr/bin/env bash
# 対話式セットアップ。デプロイ → 各サービスに貼る URL の表示 → 秘密情報の登録 までを順に行う。
# 使い方: リポジトリ直下で `bash scripts/setup.sh`
set -euo pipefail
cd "$(dirname "$0")/.."

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

# 値を入力させて wrangler secret に登録する。空 Enter ならスキップ。
put_secret() {
  local name="$1" prompt="$2" value
  read -r -s -p "  ${prompt}（スキップは Enter）: " value
  echo
  if [ -n "$value" ]; then
    printf '%s' "$value" | npx wrangler secret put "$name" >/dev/null
    echo "  → ${name} を登録しました"
  fi
}

say "1/6 準備"
npm install --silent
npx wrangler whoami >/dev/null 2>&1 || npx wrangler login

say "2/6 Cloudflare にデプロイ"
url=$(npx wrangler deploy 2>&1 | tee /dev/stderr | grep -Eo 'https://[^ ]+\.workers\.dev' | head -n1)
if [ -z "$url" ]; then
  read -r -p "  デプロイ先の URL を入力してください: " url
fi
echo "  WORKER_URL = $url"

say "3/6 LINE（必須）"
cat <<MSG
  LINE Developers (https://developers.line.biz/console/) で Messaging API チャネルを作り、
  「Messaging API 設定」の Webhook URL に次を入れて「Webhook の利用」をオンにしてください。
    ${url}/line/webhook
MSG
put_secret LINE_CHANNEL_SECRET "チャネルシークレット"
put_secret LINE_CHANNEL_ACCESS_TOKEN "チャネルアクセストークン（長期）"
echo "  公式アカウントを友だち追加して一言送ると、ID が返信されます。"
put_secret LINE_TO "返信された ID（U… または C…）"

say "4/6 Slack"
echo "  https://api.slack.com/apps →「Create New App」→「From an app manifest」に次を貼り付けてください:"
echo "  ----------------------------------------------------------------"
sed "s#WORKER_URL#${url}#g" slack-app-manifest.yml | grep -v '^#'
echo "  ----------------------------------------------------------------"
echo "  作成後「Install to Workspace」し、次の値を入力してください。"
put_secret SLACK_SIGNING_SECRET "Basic Information の Signing Secret"
put_secret SLACK_TOKEN "OAuth & Permissions の User OAuth Token（xoxp-…）"
put_secret SLACK_MY_USER_ID "自分のメンバー ID（U…）"
echo "  アプリ作成時に Request URL が「未確認」と出ていたら、Event Subscriptions 画面で「Retry」を押してください。"

say "5/6 Chatwork"
cat <<MSG
  Chatwork 右上メニュー →「サービス連携」→「Webhook」→「新規作成」で
  「アカウントイベント（自分へのメンション）」を作り、URL に次を入れてください。
    ${url}/chatwork/webhook
MSG
put_secret CHATWORK_WEBHOOK_TOKENS "Webhook のトークン（複数ならカンマ区切り）"
put_secret CHATWORK_MY_ACCOUNT_ID "自分のアカウント ID（数字）"
put_secret CHATWORK_API_TOKEN "API トークン（名前表示用・任意）"

say "6/6 LINE WORKS（管理者の承認が必要）"
cat <<MSG
  Developer Console (https://dev.worksmobile.com/jp/) で Bot を登録し、Callback URL に次を入れてください。
    ${url}/lineworks/callback
  その後、管理者に Bot を追加・公開してもらい、転送したいトークルームに招待します。
MSG
put_secret LINEWORKS_BOT_SECRETS "Bot Secret"
put_secret LINEWORKS_MY_USER_ID "自分の LINE WORKS ID"

say "完了"
echo "  各ツールでメンションや DM を送ってもらい、LINE に届くか確認してください。"
echo "  届かないときは: npx wrangler tail"
echo "  あとから足りない値を登録するときは、このスクリプトをもう一度実行すれば OK です（入力済みは Enter で飛ばせます）。"
