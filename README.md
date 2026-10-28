# chat-to-line-relay

Slack と Chatwork に届いた連絡を LINE に転送する、Cloudflare Workers 製の小さな中継サーバーです。

```
Slack (Events API) ──┐
                     ├─▶ Cloudflare Worker ──▶ LINE Messaging API（プッシュ通知）──▶ あなたの LINE
Chatwork (Webhook) ──┘
```

> LINE Notify は 2025 年 3 月末で終了したため、LINE 公式アカウント（Messaging API）から自分宛てに送る方式にしています。

## 何が転送されるか

| サービス | 転送されるもの |
| --- | --- |
| Slack | 自分宛ての DM・グループ DM／自分へのメンション／`SLACK_WATCH_CHANNELS` に指定したチャンネルの発言 |
| Chatwork | 設定した Webhook が受け取ったもの（「自分へのメンション」「指定ルームの新着メッセージ」） |

自分自身の発言、Bot の発言、メッセージの編集・削除は転送しません。LINE には次のような形で届きます。

```
【Slack】#営業
山田太郎:
@大迫 明日の資料ご確認お願いします

https://xxx.slack.com/archives/C0123/p1700000000000000
```

## 費用の注意

- Cloudflare Workers：無料枠（1 日 10 万リクエスト）で十分収まります。
- LINE 公式アカウント：**無料のコミュニケーションプランはプッシュ通知が月 200 通まで**です。超える見込みなら、ライトプラン（月 5,000 通）にするか、`SLACK_WATCH_CHANNELS` を絞るなど転送対象を減らしてください。

## セットアップ

必要なもの：Node.js 20 以上、Cloudflare アカウント（無料）、LINE アカウント、Slack／Chatwork のアカウント。

### 1. Worker をデプロイする

```bash
npm install
```

```bash
npx wrangler login
```

```bash
npx wrangler deploy
```

表示された URL（例: `https://chat-to-line-relay.<あなたのサブドメイン>.workers.dev`）を控えておきます。以下ではこれを `WORKER_URL` と書きます。

### 2. LINE 公式アカウントを作る

1. [LINE Developers](https://developers.line.biz/console/) でプロバイダーを作り、**Messaging API チャネル**を作成します。
2. 「チャネル基本設定」の **チャネルシークレット** と、「Messaging API 設定」で発行した **チャネルアクセストークン（長期）** を登録します。

   ```bash
   npx wrangler secret put LINE_CHANNEL_SECRET
   ```

   ```bash
   npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
   ```

3. 「Messaging API 設定」の Webhook URL に `WORKER_URL/line/webhook` を入れ、「Webhook の利用」をオンにします。
4. LINE Official Account Manager の応答設定で「応答メッセージ」をオフにしておきます（自動返信が混ざらないように）。
5. 「Messaging API 設定」の QR コードから公式アカウントを友だち追加し、何か一言送ります。**あなたのユーザー ID が返信されます。** それを登録します。

   ```bash
   npx wrangler secret put LINE_TO
   ```

   > チームで受け取りたい場合は、公式アカウントを LINE グループに招待してそのグループで一言送ると、グループ ID が返ってきます。それを `LINE_TO` にしてください。

### 3. Slack を繋ぐ

1. [Slack API](https://api.slack.com/apps) で「Create New App → From scratch」でアプリを作ります。
2. **OAuth & Permissions → User Token Scopes** に次を追加します（自分に届いた連絡を見るので Bot ではなく User の方です）。
   - `channels:history` `groups:history` `im:history` `mpim:history`（メッセージを受け取る）
   - `users:read` `channels:read` `groups:read` `im:read` `mpim:read`（名前やチャンネル名を表示する）
3. 「Install to Workspace」でインストールし、表示された **User OAuth Token（xoxp-…）** を登録します。

   ```bash
   npx wrangler secret put SLACK_TOKEN
   ```

4. **Basic Information** の **Signing Secret** を登録します。

   ```bash
   npx wrangler secret put SLACK_SIGNING_SECRET
   ```

5. 自分のメンバー ID（Slack で自分のプロフィール →「︙」→「メンバー ID をコピー」、`U` で始まる値）を登録します。

   ```bash
   npx wrangler secret put SLACK_MY_USER_ID
   ```

6. **Event Subscriptions** をオンにし、Request URL に `WORKER_URL/slack/events` を入れます（「Verified」になれば OK）。
   **Subscribe to events on behalf of users** に `message.im` `message.mpim` `message.channels` `message.groups` を追加して保存し、求められたらアプリを再インストールします。
7. DM・メンション以外にも転送したいチャンネルがあれば、`wrangler.toml` の `SLACK_WATCH_CHANNELS` にチャンネル ID をカンマ区切りで書いて `npx wrangler deploy` し直します。

### 4. Chatwork を繋ぐ

1. Chatwork の右上メニュー →「サービス連携」→「Webhook」→「新規作成」。
2. URL に `WORKER_URL/chatwork/webhook` を入れ、イベントを選びます。
   - **アカウントイベント**：自分へのメンションをすべて受け取る（まずはこれがおすすめ）
   - **ルームイベント**：特定のルーム（DM など）の新着メッセージを受け取る。ルームごとに作成します
3. 作成後に表示される **トークン** を登録します。Webhook を複数作った場合は、それぞれのトークンをカンマ区切りで並べます。

   ```bash
   npx wrangler secret put CHATWORK_WEBHOOK_TOKENS
   ```

4. 自分のアカウント ID（「サービス連携」→「API トークン」画面やプロフィールで確認できる数字）を登録します。自分の発言を除外するのに使います。

   ```bash
   npx wrangler secret put CHATWORK_MY_ACCOUNT_ID
   ```

5. 送信者名とルーム名を表示したい場合は、「サービス連携」→「API トークン」で発行したトークンを登録します（なくても動きますが、送信者が ID 表示になります）。

   ```bash
   npx wrangler secret put CHATWORK_API_TOKEN
   ```

> アカウントイベントとルームイベントを同じルームに両方設定すると、そのルームで自分宛てにメンションされたメッセージは 2 回届きます。

## 設定値の一覧

| 名前 | 必須 | 内容 |
| --- | --- | --- |
| `LINE_CHANNEL_ACCESS_TOKEN` | ○ | LINE のチャネルアクセストークン（長期） |
| `LINE_CHANNEL_SECRET` | ○ | LINE のチャネルシークレット |
| `LINE_TO` | ○ | 転送先のユーザー ID またはグループ ID |
| `SLACK_SIGNING_SECRET` | Slack 利用時 | Slack アプリの Signing Secret |
| `SLACK_MY_USER_ID` | Slack 利用時 | 自分の Slack メンバー ID |
| `SLACK_TOKEN` | 任意 | 名前・チャンネル名・メッセージリンクの表示用 User OAuth Token |
| `SLACK_WATCH_CHANNELS` | 任意 | 追加で転送するチャンネル ID（カンマ区切り、`wrangler.toml` に記載） |
| `CHATWORK_WEBHOOK_TOKENS` | Chatwork 利用時 | Webhook のトークン（カンマ区切りで複数可） |
| `CHATWORK_MY_ACCOUNT_ID` | 任意 | 自分の Chatwork アカウント ID |
| `CHATWORK_API_TOKEN` | 任意 | 名前・ルーム名の表示用 API トークン |

Slack だけ・Chatwork だけ使う場合は、使わない方の設定は空のままで構いません。

## 開発

```bash
npm test
```

```bash
npm run typecheck
```

ローカルで動かすときは `.dev.vars.example` を `.dev.vars` にコピーして値を入れ、`npm run dev` を実行します。
受信がうまくいかないときは `npx wrangler tail` でログを確認できます。

## セキュリティ

### プログラム側の対策

- Slack・Chatwork・LINE からのリクエストはすべて署名を検証し、一致しないものは拒否します。Slack は 5 分以上前のリクエスト（使い回し）も拒否します。
- 署名用のシークレットが未設定のサービスは、受け口ごと無効（404）になります。
- LINE 公式アカウントが ID を返信するのは、`LINE_TO` が未設定の初期設定中だけです。設定後に第三者が友だち追加しても何も返しません。
- トークン類は `wrangler secret` で Cloudflare に暗号化して保存され、リポジトリには含まれません。ログにも出力しません。

### 運用で気をつけること

- **社外秘の扱い**：転送した本文は LINE（LINE ヤフー社）のサーバーを経由し、スマホのロック画面にも表示されます。社内の情報管理ルールで社外サービスへの転送が許されているか、先に確認してください。顧客情報や個人情報が多いチャンネルは `SLACK_WATCH_CHANNELS` に入れないのが安全です。
- **LINE_TO にグループを使う場合**：そのグループの全員に内容が見えます。原則は自分のユーザー ID にしてください。
- **Slack のトークンは強い権限を持ちます**：`SLACK_TOKEN`（xoxp-）はあなたが見られる全メッセージを読める鍵です。他人に渡さず、漏えいが疑われたら Slack アプリ画面で「Revoke」して再発行してください。名前表示が不要なら `SLACK_TOKEN` は登録しなくても動きます（Slack からの受信自体は Signing Secret で動きます）。
- **退職・異動時**：Slack アプリのアンインストール、Chatwork Webhook の削除、`npx wrangler delete` で停止できます。
- **Chatwork の再送**：Chatwork の署名には時刻が含まれないため、通信を盗聴された場合の再送は防げません（HTTPS なので現実的なリスクは低いです）。
