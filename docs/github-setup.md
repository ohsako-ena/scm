# GitHub だけでセットアップする手順

パソコンへのインストールは不要です。ブラウザだけで進められます。
値を貼る場所は、すべて GitHub の **Settings → Secrets and variables → Actions → 「New repository secret」** です。
（以下「Secrets に登録」と書きます。名前は大文字・小文字も含めて表の通りに入れてください）

所要時間：合計 60 分ほど

---

## 手順1：Cloudflare に登録する（5分）

1. https://dash.cloudflare.com/sign-up でメールアドレスとパスワードを入れて登録し、届いた確認メールのリンクを押す
2. ログイン後、左メニューの **「Workers & Pages」** を一度開く
   （初回は `xxxx.workers.dev` というサブドメインの名前を聞かれることがあります。好きな英字で決めてください）

## 手順2：Cloudflare の API トークンを作る（5分）

1. 右上の人型アイコン →「プロフィール」→ 左の **「API トークン」** →「トークンを作成する」
2. テンプレート **「Cloudflare Workers を編集する」** の「テンプレートを使用する」を押す
3. 「アカウント リソース」で自分のアカウントを選び、「ゾーン リソース」は「すべてのゾーン」のままで「概要に進む」→「トークンを作成する」
4. 表示されたトークンをコピーし、**Secrets に登録**：

| Name | Secret |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | いまコピーしたトークン |
| `CLOUDFLARE_ACCOUNT_ID` | Workers & Pages 画面の右側にある「アカウント ID」 |

> トークンは一度しか表示されません。紛失したら作り直せば大丈夫です。

## 手順3：1回目の配置をして URL を確認する（3分）

1. GitHub の **Actions** タブ → 左の **「Deploy」** → 右の **「Run workflow」** →「Run workflow」
2. 1〜2分で緑のチェックが付きます。実行結果を開くと、**各サービスに貼る URL と Slack 用の設定（manifest）** が表示されます。この画面は後で何度も使います

> 赤くなったときは、結果画面のエラー文言をそのまま Claude に貼ってください。

## 手順4：LINE の準備（15分）

1. https://entry.line.biz/ で **LINE 公式アカウント** を作る（「未認証アカウント」で OK、業種は適当で構いません）
2. LINE Official Account Manager（https://manager.line.biz/）でそのアカウントを開き、右上の **「設定」→「Messaging API」→「Messaging API を利用する」**。プロバイダーは新規作成（名前は自由）
3. 同じ画面に出る **Channel secret** をコピーして **Secrets に登録**：`LINE_CHANNEL_SECRET`
4. 「設定」→「応答設定」で **「応答メッセージ」をオフ**、**「Webhook」をオン** にする
5. https://developers.line.biz/console/ を開き、いま作ったチャネル →「Messaging API 設定」タブ
   - **Webhook URL** に手順3の `…/line/webhook` を貼り「更新」、**「Webhook の利用」をオン**
   - 一番下の **チャネルアクセストークン（長期）** の「発行」を押してコピーし、**Secrets に登録**：`LINE_CHANNEL_ACCESS_TOKEN`
   - 同じタブの **QR コード** をスマホで読み取り、公式アカウントを友だち追加する

## 手順5：Slack の準備（10分）

1. https://api.slack.com/apps →「Create New App」→ **「From an app manifest」** → ワークスペースを選ぶ
2. 手順3の結果画面にある **manifest をそのまま貼り付け** →「Next」→「Create」
   （Request URL が「未確認」と出ても、この時点では問題ありません）
3. 左メニュー「Install App」→「Install to Workspace」→「許可する」
   （会社の設定によっては Slack 管理者の承認待ちになります）
4. 次の 3 つを **Secrets に登録**：

| Name | どこにあるか |
| --- | --- |
| `SLACK_TOKEN` | 「OAuth & Permissions」の **User OAuth Token**（`xoxp-` で始まる） |
| `SLACK_SIGNING_SECRET` | 「Basic Information」の **Signing Secret**（「Show」を押す） |
| `SLACK_MY_USER_ID` | Slack で自分のアイコン →「プロフィール」→「︙」→「メンバー ID をコピー」（`U` で始まる） |

## 手順6：Chatwork の準備（5分）

1. Chatwork 右上の自分の名前 →「サービス連携」→ 左の **「Webhook」→「新規作成」**
   - Webhook 名：自由（例：LINE転送）
   - Webhook URL：手順3の `…/chatwork/webhook`
   - イベント：**「アカウントイベント」**（自分へのメンション）
2. 作成後に表示される **トークン** を **Secrets に登録**：`CHATWORK_WEBHOOK_TOKENS`
3. 同じ「サービス連携」→「API トークン」で発行したトークンを **Secrets に登録**：`CHATWORK_API_TOKEN`（送信者名の表示用。会社のプランによっては管理者への利用申請が必要です。なければ省略可）
4. 自分のアカウント ID を **Secrets に登録**：`CHATWORK_MY_ACCOUNT_ID`（「API トークン」画面や、自分のプロフィールのアカウント ID 欄にある数字）

## 手順7：2回目の配置（3分）

1. もう一度 **Actions → Deploy → Run workflow**（登録した値が Cloudflare に送られます）
2. Slack アプリの「Event Subscriptions」を開き、Request URL の横の **「Retry」** を押して **「Verified」** になることを確認 →「Save Changes」
3. LINE で公式アカウントに何か一言送る → **あなたのユーザー ID（`U` で始まる）が返信されます**
4. その ID を **Secrets に登録**：`LINE_TO`

## 手順8：3回目の配置と動作確認（5分）

1. もう一度 **Actions → Deploy → Run workflow**
2. 同僚に Slack と Chatwork でメンションか DM を送ってもらい、LINE に届くか確認する

これで完了です。以後、値を変えたいときは Secrets を更新して Run workflow を押すだけです。

---

## 補足

- **DM・メンション以外にも転送したい Slack チャンネルがあるとき**：Settings → Secrets and variables → Actions → **「Variables」タブ** →「New repository variable」で、Name `SLACK_WATCH_CHANNELS`、Value にチャンネル ID（チャンネル名を右クリック →「リンクをコピー」の末尾の `C…`）をカンマ区切りで入れ、Run workflow。
- **登録した値は GitHub にも Cloudflare にも暗号化して保存され**、画面やログには表示されません。
- **止めたいとき**：Cloudflare の Workers & Pages で `chat-to-line-relay` を削除、Slack アプリをアンインストール、Chatwork の Webhook を削除。

| Secrets の名前 | 必須 | 手順 |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | ○ | 2 |
| `CLOUDFLARE_ACCOUNT_ID` | ○ | 2 |
| `LINE_CHANNEL_SECRET` | ○ | 4 |
| `LINE_CHANNEL_ACCESS_TOKEN` | ○ | 4 |
| `LINE_TO` | ○ | 7 |
| `SLACK_TOKEN` | ○ | 5 |
| `SLACK_SIGNING_SECRET` | ○ | 5 |
| `SLACK_MY_USER_ID` | ○ | 5 |
| `CHATWORK_WEBHOOK_TOKENS` | ○ | 6 |
| `CHATWORK_MY_ACCOUNT_ID` | 推奨 | 6 |
| `CHATWORK_API_TOKEN` | 任意 | 6 |
