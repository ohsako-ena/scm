import { hmacBase64, safeEqual } from "./crypto";
import type { Env } from "./env";

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
 * 友だち追加やメッセージ送信に対して、LINE_TO に設定すべき ID を返信する（初期設定用）。
 */
export async function handleLineWebhook(req: Request, env: Env): Promise<Response> {
  const body = await req.text();
  const signature = req.headers.get("x-line-signature") ?? "";
  const expected = await hmacBase64(env.LINE_CHANNEL_SECRET, body);
  if (!safeEqual(signature, expected)) {
    return new Response("invalid signature", { status: 401 });
  }

  const { events } = JSON.parse(body) as { events: LineEvent[] };
  for (const ev of events) {
    if (!ev.replyToken || (ev.type !== "follow" && ev.type !== "message")) continue;
    const id = ev.source?.groupId ?? ev.source?.userId;
    if (!id) continue;
    const label = ev.source?.groupId ? "このグループの ID" : "あなたのユーザー ID";
    await reply(env, ev.replyToken, `${label}:\n${id}\n\nこの値を LINE_TO に設定すると、ここに通知が届きます。`);
  }
  return new Response("ok");
}
