import { readFile } from "node:fs/promises";
import { join, normalize } from "node:path";
import { MEDIA_DIR } from "../../guest/paths";
import { uploadBuffer } from "../../storage";
import type { ComfyHistoryPayload, ComfyQueuePayload } from "../jobs";
import { normalizeComfyJob } from "../jobs";
import type { JobSnapshot } from "../types";
import { ProviderError } from "../errors";
import { getComfyUiUrl } from "../settings";
import { comfyIsAvailable, comfySubmitPrompt } from "./http";

export type FetchLike = typeof fetch;

export interface ComfyClientOptions {
  baseUrl?: string;
  fetchFn?: FetchLike;
  clientId?: string;
}

function mimeFromFilename(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}

async function readLocalGenerated(url: string): Promise<Buffer> {
  if (!url.startsWith("/generated/")) {
    throw new ProviderError("invalid_request", "Only /generated/... reference URLs are supported");
  }
  const rel = normalize(decodeURIComponent(url.slice("/generated/".length).split(/[?#]/)[0]));
  if (rel.startsWith("..") || rel.includes("\0")) {
    throw new ProviderError("invalid_request", "Refusing to read outside media dir");
  }
  return readFile(join(MEDIA_DIR, rel));
}

export class ComfyUiClient {
  readonly baseUrl: string;
  readonly fetchFn: FetchLike;
  readonly clientId: string;

  constructor(opts: ComfyClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? getComfyUiUrl()).replace(/\/$/, "");
    this.fetchFn = opts.fetchFn ?? fetch;
    this.clientId = opts.clientId ?? `helios-${Math.random().toString(36).slice(2, 10)}`;
  }

  private url(path: string): string {
    return `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  }

  async isAvailable(): Promise<boolean> {
    return comfyIsAvailable(this.baseUrl, this.fetchFn);
  }

  async listWorkflowFiles(): Promise<string[]> {
    const tryDirs = ["/api/userdata?dir=workflows", "/userdata?dir=workflows"];
    for (const path of tryDirs) {
      try {
        const res = await this.fetchFn(this.url(path), { method: "GET" });
        if (!res.ok) continue;
        const data: unknown = await res.json();
        if (Array.isArray(data)) {
          return data
            .map((item) => {
              if (typeof item === "string") return item;
              if (item && typeof item === "object" && "name" in item) {
                return String((item as { name: string }).name);
              }
              return null;
            })
            .filter((n): n is string => !!n);
        }
      } catch {
        /* try next */
      }
    }
    return [];
  }

  async submitPrompt(workflow: Record<string, unknown>): Promise<string> {
    return comfySubmitPrompt(this.baseUrl, workflow, this.clientId, this.fetchFn);
  }

  async getQueue(): Promise<ComfyQueuePayload> {
    const res = await this.fetchFn(this.url("/queue"));
    if (!res.ok) {
      throw new ProviderError("upstream", `ComfyUI /queue failed (${res.status})`, 502);
    }
    return (await res.json()) as ComfyQueuePayload;
  }

  async getHistory(promptId: string): Promise<ComfyHistoryPayload> {
    const res = await this.fetchFn(this.url(`/history/${encodeURIComponent(promptId)}`));
    if (!res.ok) {
      throw new ProviderError("upstream", `ComfyUI /history failed (${res.status})`, 502);
    }
    return (await res.json()) as ComfyHistoryPayload;
  }

  async getJobSnapshot(promptId: string): Promise<JobSnapshot & { media?: ReturnType<typeof normalizeComfyJob>["media"] }> {
    const [queue, history] = await Promise.all([this.getQueue(), this.getHistory(promptId)]);
    const normalized = normalizeComfyJob(promptId, queue, history);
    return {
      status: normalized.status,
      errorMessage: normalized.errorMessage,
      media: normalized.media,
    };
  }

  /** Upload a local `/generated/...` image into ComfyUI's input folder. */
  async uploadGeneratedImage(localUrl: string): Promise<string> {
    const buf = await readLocalGenerated(localUrl);
    const filename = localUrl.split("/").pop() || `ref-${Date.now()}.png`;
    const form = new FormData();
    form.append(
      "image",
      new Blob([new Uint8Array(buf)], { type: mimeFromFilename(filename) }),
      filename,
    );
    form.append("overwrite", "true");
    const res = await this.fetchFn(this.url("/upload/image"), {
      method: "POST",
      body: form,
    });
    if (!res.ok) {
      throw new ProviderError("upstream", `ComfyUI image upload failed (${res.status})`, 502);
    }
    const json = (await res.json()) as { name?: string };
    if (!json.name) {
      throw new ProviderError("upstream", "ComfyUI upload returned no filename", 502);
    }
    return json.name;
  }

  async viewFile(filename: string, subfolder: string, type: string): Promise<Buffer> {
    const qs = new URLSearchParams({
      filename,
      subfolder,
      type,
    });
    const res = await this.fetchFn(this.url(`/view?${qs.toString()}`));
    if (!res.ok) {
      throw new ProviderError("upstream", `ComfyUI /view failed (${res.status})`, 502);
    }
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  }

  /** Copy ComfyUI outputs into HELIOS_MEDIA_DIR as `/generated/...` URLs. */
  async copyOutputsToMedia(
    media: Array<{ filename: string; subfolder: string; type: string; kind: "image" | "video" }>,
  ): Promise<{ imageUrls: string[]; videoUrl?: string }> {
    const imageUrls: string[] = [];
    let videoUrl: string | undefined;
    for (const item of media) {
      const buf = await this.viewFile(item.filename, item.subfolder, item.type);
      const mime = mimeFromFilename(item.filename);
      const url = await uploadBuffer(buf, mime, "generated");
      if (item.kind === "video" || mime.startsWith("video/")) {
        videoUrl = videoUrl ?? url;
      } else {
        imageUrls.push(url);
      }
    }
    return { imageUrls, videoUrl };
  }
}

export function createComfyClient(opts?: ComfyClientOptions): ComfyUiClient {
  return new ComfyUiClient(opts);
}
