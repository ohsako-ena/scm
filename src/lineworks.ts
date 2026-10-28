import { hmacBase64, safeEqual } from "./crypto";
import { type Env, parseJson, splitList } from "./env";
import { pushToLine } from "./line";

interface LineWorksCallback {
  type: string;
  source?: { userId?: string; channelId?: string; domainId?: number };
  content?: { type: string; text?: string; fileName?: string };
}

/** Bot ごとの Bot Secret で本文の HMAC-SHA256（Base64）を取り、X-WORKS-Signature と比較する */
export async function verifyLineWorksSignature(secrets: string[], body: string, signature: string): Promise<boolean> {
  if (!signature) return false;
  for (const secret of secrets) {
    if (safeEqual(signature, await hmacBase64(secret, body))) return true;
  }
  return false;
}

export function formatLineWorksMessage(ev: LineWorksCallback): string | undefined {
  if (ev.type !== "message" || !ev.content) return undefined;
  const body =
    ev.content.type === "text"
      ? ev.content.text
      : ev.content.type === "file"
        ? `📎 ${ev.content.fileName ?? "ファイル"}`
        : `（${ev.content.type}）`;
  if (!body) return undefined;
  const where = ev.source?.channelId ? "トークルーム" : "Bot との 1:1";
  return [`【LINE WORKS】${where}`, `${ev.source?.userId ?? "不明"}:`, body].join("\n");
}

/**
 * LINE WORKS Bot の Callback。
 * Bot は自分が参加しているトークルームと、Bot 宛ての 1:1 トークのメッセージしか受け取れない。
 */
export async function handleLineWorks(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const secrets = splitList(env.LINEWORKS_BOT_SECRETS);
  if (secrets.length === 0) return new Response("lineworks not configured", { status: 404 });

  const body = await req.text();
  if (!(await verifyLineWorksSignature(secrets, body, req.headers.get("x-works-signature") ?? ""))) {
    return new Response("invalid signature", { status: 401 });
  }

  const ev = parseJson<LineWorksCallback>(body);
  if (!ev) return new Response("bad request", { status: 400 });
  if (env.LINEWORKS_MY_USER_ID && ev.source?.userId === env.LINEWORKS_MY_USER_ID) return new Response("ok");

  const text = formatLineWorksMessage(ev);
  if (text) ctx.waitUntil(pushToLine(env, text).catch((e) => console.error(e)));
  return new Response("ok");
}
