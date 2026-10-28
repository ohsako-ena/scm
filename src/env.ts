export interface Env {
  // LINE Messaging API
  LINE_CHANNEL_ACCESS_TOKEN: string;
  LINE_CHANNEL_SECRET: string;
  /** 転送先の LINE ユーザー ID（U から始まる 33 文字）またはグループ ID */
  LINE_TO: string;

  // Slack
  SLACK_SIGNING_SECRET?: string;
  /** 自分の Slack メンバー ID。自分の発言を除外し、自分宛てメンションを判定するのに使う */
  SLACK_MY_USER_ID?: string;
  /** DM・メンション以外にも転送したいチャンネル ID（カンマ区切り） */
  SLACK_WATCH_CHANNELS?: string;
  /** 任意。送信者名・チャンネル名を表示するための User OAuth Token (xoxp-) */
  SLACK_TOKEN?: string;

  // Chatwork
  /** Webhook 設定ごとのトークン（カンマ区切りで複数可） */
  CHATWORK_WEBHOOK_TOKENS?: string;
  /** 自分の Chatwork アカウント ID。自分の発言を除外するのに使う */
  CHATWORK_MY_ACCOUNT_ID?: string;
  /** 任意。送信者名・ルーム名を表示するための API トークン */
  CHATWORK_API_TOKEN?: string;
}

export function splitList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
