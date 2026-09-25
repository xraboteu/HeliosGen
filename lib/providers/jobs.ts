import type { JobStatus } from "./types";

/** Minimal shapes from ComfyUI `/queue` and `/history/{id}`. */
export interface ComfyQueuePayload {
  queue_running?: Array<[number, string, ...unknown[]] | { prompt_id?: string }>;
  queue_pending?: Array<[number, string, ...unknown[]] | { prompt_id?: string }>;
}

export interface ComfyHistoryEntry {
  status?: {
    status_str?: string;
    completed?: boolean;
    messages?: unknown[];
  };
  outputs?: Record<
    string,
    {
      images?: Array<{ filename: string; subfolder?: string; type?: string }>;
      gifs?: Array<{ filename: string; subfolder?: string; type?: string }>;
      videos?: Array<{ filename: string; subfolder?: string; type?: string }>;
    }
  >;
}

export interface ComfyHistoryPayload {
  [promptId: string]: ComfyHistoryEntry | undefined;
}

export interface NormalizedJob {
  status: JobStatus;
  errorMessage?: string;
  /** Filenames as reported by ComfyUI (not yet copied locally). */
  media: Array<{
    filename: string;
    subfolder: string;
    type: string;
    kind: "image" | "video";
  }>;
}

function collectPromptIds(
  items: ComfyQueuePayload["queue_running"] | ComfyQueuePayload["queue_pending"],
): Set<string> {
  const ids = new Set<string>();
  if (!items) return ids;
  for (const item of items) {
    if (Array.isArray(item) && typeof item[1] === "string") {
      ids.add(item[1]);
    } else if (item && typeof item === "object" && "prompt_id" in item) {
      const id = (item as { prompt_id?: string }).prompt_id;
      if (typeof id === "string") ids.add(id);
    }
  }
  return ids;
}

function extractMedia(entry: ComfyHistoryEntry): NormalizedJob["media"] {
  const media: NormalizedJob["media"] = [];
  const outputs = entry.outputs ?? {};
  for (const nodeOut of Object.values(outputs)) {
    if (!nodeOut) continue;
    for (const img of nodeOut.images ?? []) {
      media.push({
        filename: img.filename,
        subfolder: img.subfolder ?? "",
        type: img.type ?? "output",
        kind: "image",
      });
    }
    for (const gif of nodeOut.gifs ?? []) {
      const lower = gif.filename.toLowerCase();
      const kind = lower.endsWith(".mp4") || lower.endsWith(".webm") ? "video" : "image";
      media.push({
        filename: gif.filename,
        subfolder: gif.subfolder ?? "",
        type: gif.type ?? "output",
        kind,
      });
    }
    for (const vid of nodeOut.videos ?? []) {
      media.push({
        filename: vid.filename,
        subfolder: vid.subfolder ?? "",
        type: vid.type ?? "output",
        kind: "video",
      });
    }
  }
  return media;
}

/**
 * Pure normalization of ComfyUI queue + history into an internal job status.
 * Safe to unit-test with injected fixtures (no I/O).
 */
export function normalizeComfyJob(
  promptId: string,
  queue: ComfyQueuePayload | null | undefined,
  history: ComfyHistoryPayload | null | undefined,
): NormalizedJob {
  const entry = history?.[promptId];
  if (entry) {
    const statusStr = (entry.status?.status_str ?? "").toLowerCase();
    const completed = entry.status?.completed === true || statusStr === "success";
    const failed =
      statusStr === "error" ||
      statusStr === "failed" ||
      statusStr === "interrupted";

    if (failed) {
      return {
        status: "error",
        errorMessage: "ComfyUI reported that the prompt failed",
        media: [],
      };
    }

    const media = extractMedia(entry);
    if (completed || media.length > 0) {
      if (media.length === 0) {
        return {
          status: "error",
          errorMessage: "ComfyUI finished but returned no image or video outputs",
          media: [],
        };
      }
      return { status: "done", media };
    }

    // In history but not completed yet — treat as running.
    return { status: "running", media: [] };
  }

  const running = collectPromptIds(queue?.queue_running);
  const pending = collectPromptIds(queue?.queue_pending);

  if (running.has(promptId)) return { status: "running", media: [] };
  if (pending.has(promptId)) return { status: "pending", media: [] };

  // Not in queue and not in history yet — still pending (just submitted).
  return { status: "pending", media: [] };
}
