import { hmacHex, safeEqual } from "./crypto";
import { type Env, splitList } from "./env";
import { pushToLine } from "./line";

/** Slack が許容する署名タイムスタンプのずれ（リプレイ攻撃対策） */
const MAX_SKEW_SECONDS = 60 * 5;

export interface SlackMessageEvent {
  type: string;
  subtype?: string;
  user?: string;
  bot_id?: string;
  text?: string;
  channel: string;
  channel_type?: "im" | "mpim" | "channel" | "group";
  ts: string;
  thread_ts?: string;
}

interface SlackPayload {
  type: string;
  challenge?: string;
  team_id?: string;
  event?: SlackMessageEvent;
}

/** 転送しても意味のある subtype（通常の発言・ファイル付き・スレッドからチャンネルへの投稿） */
const FORWARDED_SUBTYPES = new Set([undefined, "file_share", "thread_broadcast"]);

export async function verifySlackSignature(
  secret: string,
  timestamp: string,
  body: string,
  signature: string,
  now = Date.now() / 1000,
): Promise<boolean> {
  if (!timestamp || Math.abs(now - Number(timestamp)) > MAX_SKEW_SECONDS) return false;
  const expected = "v0=" + (await hmacHex(secret, `v0:${timestamp}:${body}`));
  return safeEqual(signature, expected);
}

export function shouldForward(ev: SlackMessageEvent, env: Env): boolean {
  if (ev.type !== "message" || !FORWARDED_SUBTYPES.has(ev.subtype)) return false;
  if (ev.bot_id || !ev.user) return false;
  if (env.SLACK_MY_USER_ID && ev.user === env.SLACK_MY_USER_ID) return false;

  if (ev.channel_type === "im" || ev.channel_type === "mpim") return true;
  if (env.SLACK_MY_USER_ID && (ev.text ?? "").includes(`<@${env.SLACK_MY_USER_ID}>`)) return true;
  return splitList(env.SLACK_WATCH_CHANNELS).includes(ev.channel);
}

/** Slack の mrkdwn を LINE 向けの素のテキストに寄せる */
export function cleanSlackText(text: string, names: Map<string, string> = new Map()): string {
  return text
    .replace(/<@([A-Z0-9]+)(?:\|[^>]+)?>/g, (_, id: string) => `@${names.get(id) ?? id}`)
    .replace(/<#[A-Z0-9]+\|([^>]+)>/g, "#$1")
    .replace(/<!(here|channel|everyone)>/g, "@$1")
    .replace(/<(https?:[^|>]+)\|([^>]+)>/g, "$2 ($1)")
    .replace(/<(https?:[^>]+)>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

async function slackApi<T>(env: Env, method: string, params: Record<string, string>): Promise<T | undefined> {
  if (!env.SLACK_TOKEN) return undefined;
  const res = await fetch(`https://slack.com/api/${method}?${new URLSearchParams(params)}`, {
    headers: { Authorization: `Bearer ${env.SLACK_TOKEN}` },
  });
  const json = (await res.json()) as { ok: boolean } & T;
  return json.ok ? json : undefined;
}

async function userName(env: Env, id: string): Promise<string> {
  const r = await slackApi<{ user: { real_name?: string; name: string; profile?: { display_name?: string } } }>(
    env,
    "users.info",
    { user: id },
  );
  return r?.user.profile?.display_name || r?.user.real_name || r?.user.name || id;
}

async function channelLabel(env: Env, ev: SlackMessageEvent): Promise<string> {
  if (ev.channel_type === "im") return "DM";
  const r = await slackApi<{ channel: { name?: string } }>(env, "conversations.info", { channel: ev.channel });
  if (ev.channel_type === "mpim") return "グループDM";
  return r?.channel.name ? `#${r.channel.name}` : ev.channel;
}

async function permalink(env: Env, ev: SlackMessageEvent, teamId?: string): Promise<string | undefined> {
  const r = await slackApi<{ permalink: string }>(env, "chat.getPermalink", { channel: ev.channel, message_ts: ev.ts });
  if (r) return r.permalink;
  return teamId ? `https://app.slack.com/client/${teamId}/${ev.channel}` : undefined;
}

export async function formatSlackMessage(env: Env, ev: SlackMessageEvent, teamId?: string): Promise<string> {
  const text = ev.text ?? "";
  const mentionIds = [...new Set([...text.matchAll(/<@([A-Z0-9]+)/g)].map((m) => m[1]))];
  const [sender, where, ...mentionNames] = await Promise.all([
    userName(env, ev.user!),
    channelLabel(env, ev),
    ...mentionIds.map((id) => userName(env, id)),
  ]);
  const names = new Map(mentionIds.map((id, i) => [id, mentionNames[i]]));

  const lines = [`【Slack】${where}`, `${sender}:`, cleanSlackText(text, names) || "（ファイル）"];
  const link = await permalink(env, ev, teamId);
  if (link) lines.push("", link);
  return lines.join("\n");
}

export async function handleSlack(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const body = await req.text();
  if (!env.SLACK_SIGNING_SECRET) return new Response("slack not configured", { status: 404 });

  const ok = await verifySlackSignature(
    env.SLACK_SIGNING_SECRET,
    req.headers.get("x-slack-request-timestamp") ?? "",
    body,
    req.headers.get("x-slack-signature") ?? "",
  );
  if (!ok) return new Response("invalid signature", { status: 401 });

  const payload = JSON.parse(body) as SlackPayload;
  if (payload.type === "url_verification") {
    return new Response(payload.challenge ?? "", { headers: { "Content-Type": "text/plain" } });
  }

  // 応答が 3 秒を超えると Slack が再送してくる。再送分は二重通知になるので捨てる。
  if (req.headers.get("x-slack-retry-num")) return new Response("ok");

  const ev = payload.event;
  if (payload.type === "event_callback" && ev && shouldForward(ev, env)) {
    ctx.waitUntil(
      formatSlackMessage(env, ev, payload.team_id)
        .then((text) => pushToLine(env, text))
        .catch((e) => console.error(e)),
    );
  }
  return new Response("ok");
}
