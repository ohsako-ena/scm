import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanChatworkText, verifyChatworkSignature } from "../src/chatwork";
import { hmacBase64, hmacHex, toBase64 } from "../src/crypto";
import type { Env } from "../src/env";
import worker from "../src/index";
import { cleanSlackText, shouldForward, verifySlackSignature } from "../src/slack";

const env: Env = {
  LINE_CHANNEL_ACCESS_TOKEN: "line-token",
  LINE_CHANNEL_SECRET: "line-secret",
  LINE_TO: "U0000000000000000000000000000000",
  SLACK_SIGNING_SECRET: "slack-secret",
  SLACK_MY_USER_ID: "UME",
  SLACK_WATCH_CHANNELS: "CWATCH",
  CHATWORK_WEBHOOK_TOKENS: btoa("chatwork-token"),
  CHATWORK_MY_ACCOUNT_ID: "100",
};

function makeCtx() {
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() {} };
  return { ctx: ctx as unknown as ExecutionContext, settle: () => Promise.all(pending) };
}

function mockLine() {
  const pushed: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      if (url === "https://api.line.me/v2/bot/message/push") {
        pushed.push(JSON.parse(init.body as string).messages[0].text);
        return new Response("{}");
      }
      throw new Error(`unexpected fetch ${url}`);
    }),
  );
  return pushed;
}

afterEach(() => vi.unstubAllGlobals());

describe("Slack", () => {
  it("verifies the signature example from the Slack docs", async () => {
    const body =
      "token=xyzz0WbapA4vBCDEFasx0q6G&team_id=T1DC2JH3J&team_domain=testteamnow&channel_id=G8PSS9T3V&channel_name=foobar&user_id=U2CERLKJA&user_name=roadrunner&command=%2Fwebhook-collect&text=&response_url=https%3A%2F%2Fhooks.slack.com%2Fcommands%2FT1DC2JH3J%2F397700885554%2F96rGlfmibIGlgcZRskXaIFfN&trigger_id=398738663015.47445629121.803a0bc887a14d10d2c447fce8b6703c";
    const sig = "v0=a2114d57b48eac39b9ad189dd8316235a7b4a8d21a10bd27519666489c69b503";
    expect(await verifySlackSignature("8f742231b10e8888abcd99yyyzzz85a5", "1531420618", body, sig, 1531420618)).toBe(
      true,
    );
    expect(await verifySlackSignature("8f742231b10e8888abcd99yyyzzz85a5", "1531420618", body, sig, 1531420618 + 600)).toBe(
      false,
    );
  });

  it("forwards DMs, mentions and watched channels only", () => {
    const base = { type: "message", user: "UOTHER", ts: "1.2", text: "hi" };
    expect(shouldForward({ ...base, channel: "D1", channel_type: "im" }, env)).toBe(true);
    expect(shouldForward({ ...base, channel: "C1", channel_type: "channel", text: "<@UME> 見て" }, env)).toBe(true);
    expect(shouldForward({ ...base, channel: "CWATCH", channel_type: "channel" }, env)).toBe(true);
    expect(shouldForward({ ...base, channel: "C1", channel_type: "channel" }, env)).toBe(false);
    expect(shouldForward({ ...base, user: "UME", channel: "D1", channel_type: "im" }, env)).toBe(false);
    expect(shouldForward({ ...base, subtype: "message_changed", channel: "D1", channel_type: "im" }, env)).toBe(false);
    expect(shouldForward({ ...base, bot_id: "B1", channel: "D1", channel_type: "im" }, env)).toBe(false);
  });

  it("cleans mrkdwn", () => {
    expect(cleanSlackText("<@UME> see <https://a.b|link> &amp; <#C1|general> <!here>", new Map([["UME", "me"]]))).toBe(
      "@me see link (https://a.b) & #general @here",
    );
  });

  it("acks url_verification and pushes a DM to LINE", async () => {
    const pushed = mockLine();
    const post = async (payload: object, headers: Record<string, string> = {}) => {
      const body = JSON.stringify(payload);
      const ts = String(Math.floor(Date.now() / 1000));
      const sig = "v0=" + (await hmacHex("slack-secret", `v0:${ts}:${body}`));
      const { ctx, settle } = makeCtx();
      const res = await worker.fetch(
        new Request("https://x/slack/events", {
          method: "POST",
          body,
          headers: { "x-slack-request-timestamp": ts, "x-slack-signature": sig, ...headers },
        }),
        env,
        ctx,
      );
      await settle();
      return res;
    };

    const challenge = await post({ type: "url_verification", challenge: "abc" });
    expect(await challenge.text()).toBe("abc");

    const event = {
      type: "event_callback",
      team_id: "T1",
      event: { type: "message", user: "UOTHER", text: "こんにちは", channel: "D1", channel_type: "im", ts: "1.2" },
    };
    expect((await post(event)).status).toBe(200);
    expect(pushed).toEqual(["【Slack】DM\nUOTHER:\nこんにちは\n\nhttps://app.slack.com/client/T1/D1"]);

    await post(event, { "x-slack-retry-num": "1" });
    expect(pushed).toHaveLength(1);
  });

  it("rejects a bad signature", async () => {
    const { ctx } = makeCtx();
    const res = await worker.fetch(
      new Request("https://x/slack/events", {
        method: "POST",
        body: "{}",
        headers: { "x-slack-request-timestamp": String(Math.floor(Date.now() / 1000)), "x-slack-signature": "v0=00" },
      }),
      env,
      ctx,
    );
    expect(res.status).toBe(401);
  });
});

describe("Chatwork", () => {
  it("verifies with any configured token", async () => {
    const body = '{"a":1}';
    const sig = await hmacBase64(new TextEncoder().encode("chatwork-token"), body);
    expect(await verifyChatworkSignature([btoa("other"), btoa("chatwork-token")], body, sig)).toBe(true);
    expect(await verifyChatworkSignature([btoa("other")], body, sig)).toBe(false);
  });

  it("cleans tags", () => {
    expect(cleanChatworkText("[To:123]山田さん\n[info][title]件名[/title]本文[/info]")).toBe("@山田さん\n【件名】\n本文");
  });

  it("pushes a mention to LINE and skips own messages", async () => {
    const pushed = mockLine();
    const post = async (payload: object, viaQuery = false) => {
      const body = JSON.stringify(payload);
      const sig = await hmacBase64(new TextEncoder().encode("chatwork-token"), body);
      const url = viaQuery
        ? `https://x/chatwork/webhook?chatwork_webhook_signature=${encodeURIComponent(sig)}`
        : "https://x/chatwork/webhook";
      const { ctx, settle } = makeCtx();
      const res = await worker.fetch(
        new Request(url, { method: "POST", body, headers: viaQuery ? {} : { "x-chatworkwebhooksignature": sig } }),
        env,
        ctx,
      );
      await settle();
      return res;
    };

    const mention = {
      webhook_setting_id: "1",
      webhook_event_type: "mention_to_me",
      webhook_event: { message_id: "9", room_id: 5, from_account_id: 200, body: "[To:100]私 確認お願いします" },
    };
    expect((await post(mention)).status).toBe(200);
    expect(await post(mention, true)).toHaveProperty("status", 200);
    expect(pushed[0]).toBe(
      "【Chatwork】ルーム 5（あなた宛て）\nID:200:\n@私 確認お願いします\n\nhttps://www.chatwork.com/#!rid5-9",
    );
    expect(pushed).toHaveLength(2);

    await post({
      webhook_setting_id: "2",
      webhook_event_type: "message_created",
      webhook_event: { message_id: "10", room_id: 5, account_id: 100, body: "自分の発言" },
    });
    expect(pushed).toHaveLength(2);
  });
});

it("toBase64 round-trips", () => {
  expect(toBase64(new TextEncoder().encode("abc").buffer as ArrayBuffer)).toBe("YWJj");
});

describe("hardening", () => {
  it("rejects non-numeric Slack timestamps", async () => {
    const body = "{}";
    const sig = "v0=" + (await hmacHex("slack-secret", `v0:abc:${body}`));
    expect(await verifySlackSignature("slack-secret", "abc", body, sig)).toBe(false);
  });

  it("returns 400 for a validly signed but malformed Slack body", async () => {
    const body = "not json";
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = "v0=" + (await hmacHex("slack-secret", `v0:${ts}:${body}`));
    const { ctx } = makeCtx();
    const res = await worker.fetch(
      new Request("https://x/slack/events", {
        method: "POST",
        body,
        headers: { "x-slack-request-timestamp": ts, "x-slack-signature": sig },
      }),
      env,
      ctx,
    );
    expect(res.status).toBe(400);
  });

  it("refuses LINE webhooks when the channel secret is missing", async () => {
    const body = JSON.stringify({ events: [] });
    const forged = "AAAA";
    const { ctx } = makeCtx();
    const res = await worker.fetch(
      new Request("https://x/line/webhook", { method: "POST", body, headers: { "x-line-signature": forged } }),
      { ...env, LINE_CHANNEL_SECRET: "" },
      ctx,
    );
    expect(res.status).toBe(404);
  });

  it("only replies with IDs while LINE_TO is unset", async () => {
    const replies: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        replies.push(JSON.parse(init.body as string).messages[0].text);
        return new Response("{}");
      }),
    );
    const body = JSON.stringify({ events: [{ type: "follow", replyToken: "r", source: { type: "user", userId: "UABC" } }] });
    const sig = await hmacBase64("line-secret", body);
    const send = (e: Env) =>
      worker.fetch(
        new Request("https://x/line/webhook", { method: "POST", body, headers: { "x-line-signature": sig } }),
        e,
        makeCtx().ctx,
      );

    await send(env);
    expect(replies).toHaveLength(0);
    await send({ ...env, LINE_TO: "" });
    expect(replies[0]).toContain("UABC");
  });

  it("ignores malformed Chatwork tokens instead of crashing", async () => {
    expect(await verifyChatworkSignature(["***not base64***"], "{}", "x")).toBe(false);
  });
});

describe("LINE WORKS", () => {
  it("forwards signed room messages, skips own and unsigned ones", async () => {
    const pushed = mockLine();
    const e = { ...env, LINEWORKS_BOT_SECRETS: "works-secret", LINEWORKS_MY_USER_ID: "me@loive" };
    const post = async (payload: object, sign = true) => {
      const body = JSON.stringify(payload);
      const sig = sign ? await hmacBase64("works-secret", body) : "bad";
      const { ctx, settle } = makeCtx();
      const res = await worker.fetch(
        new Request("https://x/lineworks/callback", { method: "POST", body, headers: { "x-works-signature": sig } }),
        e,
        ctx,
      );
      await settle();
      return res;
    };
    const msg = (userId: string) => ({
      type: "message",
      source: { userId, channelId: "ch1", domainId: 1 },
      content: { type: "text", text: "お疲れさまです" },
    });

    expect((await post(msg("tanaka@loive"))).status).toBe(200);
    expect(pushed).toEqual(["【LINE WORKS】トークルーム\ntanaka@loive:\nお疲れさまです"]);
    await post(msg("me@loive"));
    expect((await post(msg("tanaka@loive"), false)).status).toBe(401);
    expect(pushed).toHaveLength(1);
  });
});
