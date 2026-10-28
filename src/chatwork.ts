import { fromBase64, hmacBase64, safeEqual } from "./crypto";
import { type Env, parseJson, splitList } from "./env";
import { pushToLine } from "./line";

interface ChatworkPayload {
  webhook_setting_id: string;
  webhook_event_type: "mention_to_me" | "message_created" | "message_updated";
  webhook_event: {
    message_id: string;
    room_id: number;
    /** message_created / message_updated の送信者 */
    account_id?: number;
    /** mention_to_me の送信者 */
    from_account_id?: number;
    body: string;
  };
}

/**
 * Webhook 設定ごとのトークン（Base64）で本文の HMAC-SHA256 を取り、署名と比較する。
 * 署名はヘッダー X-ChatWorkWebhookSignature とクエリ chatwork_webhook_signature の両方で届く。
 */
export async function verifyChatworkSignature(tokens: string[], body: string, signature: string): Promise<boolean> {
  if (!signature) return false;
  for (const token of tokens) {
    let key: Uint8Array;
    try {
      key = fromBase64(token);
    } catch {
      continue; // 設定ミスのトークンは無視する
    }
    if (safeEqual(signature, await hmacBase64(key, body))) return true;
  }
  return false;
}

/** Chatwork の記法タグを LINE 向けの素のテキストに寄せる */
export function cleanChatworkText(body: string): string {
  return body
    .replace(/\[To:\d+\]/g, "@")
    .replace(/\[toall\]/g, "@all ")
    .replace(/\[rp aid=\d+ to=[\d-]+\]/g, "↩︎ ")
    .replace(/\[piconname:\d+\]/g, "")
    .replace(/\[picon:\d+\]/g, "")
    .replace(/\[qt\]\[qtmeta[^\]]*\]/g, "> ")
    .replace(/\[\/qt\]/g, "\n")
    .replace(/\[info\]\[title\](.*?)\[\/title\]/gs, "【$1】\n")
    .replace(/\[\/?(info|title|code|hr)\]/g, "")
    .replace(/\[download:\d+\](.*?)\[\/download\]/gs, "📎 $1")
    .trim();
}

async function chatworkApi<T>(env: Env, path: string): Promise<T | undefined> {
  if (!env.CHATWORK_API_TOKEN) return undefined;
  const res = await fetch(`https://api.chatwork.com/v2${path}`, {
    headers: { "X-ChatWorkToken": env.CHATWORK_API_TOKEN },
  });
  return res.ok ? ((await res.json()) as T) : undefined;
}

export async function formatChatworkMessage(env: Env, p: ChatworkPayload): Promise<string> {
  const ev = p.webhook_event;
  const senderId = ev.from_account_id ?? ev.account_id;
  const [room, members] = await Promise.all([
    chatworkApi<{ name: string; type: "my" | "direct" | "group" }>(env, `/rooms/${ev.room_id}`),
    chatworkApi<{ account_id: number; name: string }[]>(env, `/rooms/${ev.room_id}/members`),
  ]);
  const sender = members?.find((m) => m.account_id === senderId)?.name ?? `ID:${senderId}`;
  const where = room ? (room.type === "direct" ? "DM" : room.name) : `ルーム ${ev.room_id}`;
  const kind = p.webhook_event_type === "mention_to_me" ? "（あなた宛て）" : "";

  return [
    `【Chatwork】${where}${kind}`,
    `${sender}:`,
    cleanChatworkText(ev.body),
    "",
    `https://www.chatwork.com/#!rid${ev.room_id}-${ev.message_id}`,
  ].join("\n");
}

export async function handleChatwork(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const tokens = splitList(env.CHATWORK_WEBHOOK_TOKENS);
  if (tokens.length === 0) return new Response("chatwork not configured", { status: 404 });

  const body = await req.text();
  const signature =
    req.headers.get("x-chatworkwebhooksignature") ??
    new URL(req.url).searchParams.get("chatwork_webhook_signature") ??
    "";
  if (!(await verifyChatworkSignature(tokens, body, signature))) {
    return new Response("invalid signature", { status: 401 });
  }

  const payload = parseJson<ChatworkPayload>(body);
  const ev = payload?.webhook_event;
  if (!payload || !ev) return new Response("bad request", { status: 400 });
  const senderId = String(ev.from_account_id ?? ev.account_id ?? "");
  // 編集通知は二重になりやすいので転送しない。自分の発言も転送しない。
  const skip =
    payload.webhook_event_type === "message_updated" ||
    (env.CHATWORK_MY_ACCOUNT_ID !== undefined && senderId === env.CHATWORK_MY_ACCOUNT_ID);

  if (!skip) {
    ctx.waitUntil(
      formatChatworkMessage(env, payload)
        .then((text) => pushToLine(env, text))
        .catch((e) => console.error(e)),
    );
  }
  return new Response("ok");
}
