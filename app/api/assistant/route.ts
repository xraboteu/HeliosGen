export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { createOllamaClient, ollamaNdjsonToOpenAiSse } from "@/lib/providers/ollama/client";
import { getOllamaModel } from "@/lib/providers/settings";
import { resolveOllamaChatModel } from "@/lib/providers/profiles";
import { isProviderError, providerErrorBody } from "@/lib/providers/errors";

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      messages?: Message[];
      prompt?: string;
      systemPrompt?: string;
      model?: string;
    };

    let messages: Message[];

    if (body.messages && body.messages.length > 0) {
      messages = body.messages;
    } else if (body.prompt?.trim()) {
      messages = [];
      if (body.systemPrompt?.trim()) {
        messages.push({ role: "system", content: body.systemPrompt.trim() });
      }
      messages.push({ role: "user", content: body.prompt.trim() });
    } else {
      return new Response(JSON.stringify({ error: "messages or prompt is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const client = createOllamaClient();
    const available = await client.isAvailable();
    if (!available) {
      return new Response(
        JSON.stringify({
          error:
            "Ollama is unreachable at the configured URL. Check Settings → Local providers.",
        }),
        { status: 503, headers: { "Content-Type": "application/json" } },
      );
    }

    let availableIds: string[] = [];
    try {
      const listed = await client.listModels();
      availableIds = listed.map((m) => m.id);
    } catch {
      availableIds = [];
    }

    const model = resolveOllamaChatModel(
      body.model,
      availableIds,
      getOllamaModel(),
    );

    if (!model) {
      return new Response(
        JSON.stringify({
          error:
            "No Ollama model available. Pull a model (e.g. ollama pull llama3.2) and choose one in Settings → Local providers.",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const upstream = await client.chatStream(
      model,
      messages.map((m) => ({
        role: m.role === "system" ? "system" : m.role,
        content: m.content,
      })),
    );

    if (!upstream.body) {
      return new Response(JSON.stringify({ error: "Ollama returned an empty body" }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }

    const sse = ollamaNdjsonToOpenAiSse(upstream.body);

    return new Response(sse, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (e: unknown) {
    if (isProviderError(e)) {
      return new Response(JSON.stringify(providerErrorBody(e)), {
        status: e.status,
        headers: { "Content-Type": "application/json" },
      });
    }
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
