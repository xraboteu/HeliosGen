import { ProviderError } from "../errors";
import { getOllamaUrl } from "../settings";
import type { ProviderModel } from "../types";

export type FetchLike = typeof fetch;

export interface OllamaClientOptions {
  baseUrl?: string;
  fetchFn?: FetchLike;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export class OllamaClient {
  readonly baseUrl: string;
  readonly fetchFn: FetchLike;

  constructor(opts: OllamaClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? getOllamaUrl()).replace(/\/$/, "");
    this.fetchFn = opts.fetchFn ?? fetch;
  }

  private url(path: string): string {
    return `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await this.fetchFn(this.url("/api/tags"), {
        method: "GET",
        signal: AbortSignal.timeout(5_000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<ProviderModel[]> {
    const res = await this.fetchFn(this.url("/api/tags"));
    if (!res.ok) {
      throw new ProviderError("upstream", `Ollama /api/tags failed (${res.status})`, 502);
    }
    const json = (await res.json()) as {
      models?: Array<{ name?: string; model?: string }>;
    };
    return (json.models ?? []).map((m) => {
      const id = m.name ?? m.model ?? "unknown";
      return { id, name: id };
    });
  }

  /**
   * Stream chat completions. Returns the raw NDJSON body from Ollama.
   * Caller translates to OpenAI SSE.
   */
  async chatStream(model: string, messages: ChatMessage[]): Promise<Response> {
    const res = await this.fetchFn(this.url("/api/chat"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ProviderError(
        "upstream",
        `Ollama chat failed (${res.status})${text ? `: ${text.slice(0, 200)}` : ""}`,
        502,
      );
    }
    return res;
  }
}

export function createOllamaClient(opts?: OllamaClientOptions): OllamaClient {
  return new OllamaClient(opts);
}

/**
 * Convert an Ollama NDJSON stream into OpenAI-compatible SSE
 * (`choices[0].delta.content` then `data: [DONE]`).
 */
export function ollamaNdjsonToOpenAiSse(upstream: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";

  return new ReadableStream({
    async start(controller) {
      const reader = upstream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            let parsed: {
              message?: { content?: string };
              done?: boolean;
              error?: string;
            };
            try {
              parsed = JSON.parse(trimmed) as typeof parsed;
            } catch {
              continue;
            }
            if (parsed.error) {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ error: { message: parsed.error } })}\n\n`,
                ),
              );
              continue;
            }
            const content = parsed.message?.content;
            if (content) {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    choices: [{ delta: { content }, index: 0 }],
                  })}\n\n`,
                ),
              );
            }
            if (parsed.done) {
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            }
          }
        }
        if (buffer.trim()) {
          try {
            const parsed = JSON.parse(buffer.trim()) as {
              message?: { content?: string };
              done?: boolean;
            };
            if (parsed.message?.content) {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    choices: [{ delta: { content: parsed.message.content }, index: 0 }],
                  })}\n\n`,
                ),
              );
            }
          } catch {
            /* ignore trailing garbage */
          }
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (e) {
        controller.error(e);
      } finally {
        reader.releaseLock();
      }
    },
  });
}
