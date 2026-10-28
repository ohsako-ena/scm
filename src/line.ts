import { hmacBase64, safeEqual } from "./crypto";
import { type Env, parseJson } from "./env";

/** LINE のテキストメッセージ上限は 5000 文字 */
const MAX_TEXT = 5000;

export function truncate(text: string, max = MAX_TEXT): string {
  return text.length <= max ? text : text.slice(0, max - 1) + "…";
}

export async function pushToLine(env: Env, text: string): Promise<void> {
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({ to: env.LINE_TO, messages: [{ type: "text", text: truncate(text) }] }),
  });
  if (!res.ok) {
    throw new Error(`LINE push failed: ${res.status} ${await res.text()}`);
  }
}

async function reply(env: Env, replyToken: string, text: string): Promise<void> {
  await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({ replyToken, messages: [{ type: "text", text }] }),
  });
}

interface LineEvent {
  type: string;
  replyToken?: string;
  source?: { type: string; userId?: string; groupId?: string };
}

/**
 * LINE 公式アカウントの Webhook。
 * LINE_TO が未設定の間だけ、友だち追加やメッセージ送信に対して LINE_TO に設定すべき ID を返信する（初期設定用）。
 */
export async function handleLineWebhook(req: Request, env: Env): Promise<Response> {
  // シークレット未設定のまま空鍵で検証すると署名が偽造できてしまうので、受け付けない
  if (!env.LINE_CHANNEL_SECRET) return new Response("line not configured", { status: 404 });
  const body = await req.text();
  const signature = req.headers.get("x-line-signature") ?? "";
  const expected = await hmacBase64(env.LINE_CHANNEL_SECRET, body);
  if (!safeEqual(signature, expected)) {
    return new Response("invalid signature", { status: 401 });
  }

  // 初期設定が済んだら ID は返さない（第三者が友だち追加しても何も起きないようにする）
  if (env.LINE_TO) return new Response("ok");

  const events = parseJson<{ events: LineEvent[] }>(body)?.events ?? [];
  for (const ev of events) {
    if (!ev.replyToken || (ev.type !== "follow" && ev.type !== "message")) continue;
    const id = ev.source?.groupId ?? ev.source?.userId;
    if (!id) continue;
    const label = ev.source?.groupId ? "このグループの ID" : "あなたのユーザー ID";
    await reply(env, ev.replyToken, `${label}:\n${id}\n\nこの値を LINE_TO に設定すると、ここに通知が届きます。`);
  }
  return new Response("ok");
}
