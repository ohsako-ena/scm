import { handleChatwork } from "./chatwork";
import type { Env } from "./env";
import { handleLineWebhook } from "./line";
import { handleSlack } from "./slack";

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(req.url);
    if (req.method === "GET" && pathname === "/") return new Response("chat-to-line-relay is running");
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

    switch (pathname) {
      case "/slack/events":
        return handleSlack(req, env, ctx);
      case "/chatwork/webhook":
        return handleChatwork(req, env, ctx);
      case "/line/webhook":
        return handleLineWebhook(req, env);
      default:
        return new Response("not found", { status: 404 });
    }
  },
} satisfies ExportedHandler<Env>;
