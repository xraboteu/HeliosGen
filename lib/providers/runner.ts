/**
 * Resumable poller for ComfyUI jobs. Tracks in-memory active tasks and
 * re-attaches to pending/running rows after a process restart via external_id.
 */
import { jobStore, type JobResult } from "@/lib/jobStore";
import { jobEvents } from "@/lib/jobEvents";
import * as guestDb from "@/lib/guest/db";
import { createComfyClient } from "./comfyui/client";
import type { JobStatus } from "./types";

const POLL_INTERVAL_MS = 2_000;
const MAX_POLL_MS = 12 * 60 * 1000;

const active = new Set<string>();
let resumeStarted = false;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function settle(taskId: string, kind: "image" | "video", result: JobResult): void {
  jobStore.set(taskId, result);
  if (result.status === "done") {
    guestDb.updateGeneration(taskId, {
      status: "done",
      image_url: result.imageUrl ?? result.imageUrls?.[0],
      image_urls: result.imageUrls,
      video_url: result.videoUrl,
    });
  } else if (result.status === "error") {
    guestDb.updateGeneration(taskId, {
      status: "error",
      error_msg: result.error,
    });
  }
  jobEvents.emit(`job:${taskId}`, result);
}

export function isPolling(taskId: string): boolean {
  return active.has(taskId);
}

export function trackProviderJob(opts: {
  taskId: string;
  externalId: string;
  provider?: string;
  capability: "image" | "video";
  taskKind?: string;
  request?: unknown;
}): void {
  const existing = guestDb.getProviderJob(opts.taskId);
  if (!existing) {
    guestDb.insertProviderJob({
      id: opts.taskId,
      provider: opts.provider ?? "comfyui",
      capability: opts.capability,
      task_kind: opts.taskKind ?? null,
      external_id: opts.externalId,
      status: "pending",
      request_json: opts.request ? JSON.stringify(opts.request) : null,
    });
  } else {
    guestDb.updateProviderJob(opts.taskId, {
      external_id: opts.externalId,
      status: "pending",
    });
  }
}

/** Start (or no-op if already) polling a ComfyUI prompt. */
export function pollProviderJob(
  taskId: string,
  externalId: string,
  kind: "image" | "video",
): void {
  if (!taskId || !externalId || active.has(taskId)) return;
  active.add(taskId);
  void loop(taskId, externalId, kind)
    .catch((e) => {
      console.error(`[provider-poller] ${taskId} crashed:`, e);
      settle(taskId, kind, {
        status: "error",
        error: "Generation failed (poller error)",
      });
    })
    .finally(() => active.delete(taskId));
}

/** Resume a single job if its poller died (e.g. after restart). */
export function resumeProviderJob(taskId: string, kind: "image" | "video"): void {
  if (active.has(taskId)) return;
  const row = guestDb.getProviderJob(taskId);
  if (!row?.external_id) return;
  if (row.status !== "pending" && row.status !== "running") return;
  pollProviderJob(taskId, row.external_id, kind);
}

/** On first call, re-attach all in-flight ComfyUI jobs. */
export function resumeInFlightJobs(): void {
  if (resumeStarted) return;
  resumeStarted = true;
  try {
    const rows = guestDb.listInFlightProviderJobs();
    for (const row of rows) {
      if (row.provider !== "comfyui" || !row.external_id) continue;
      const kind = row.capability === "video" ? "video" : "image";
      pollProviderJob(row.id, row.external_id, kind);
    }
  } catch (e) {
    console.warn("[provider-poller] resumeInFlightJobs failed:", (e as Error).message);
  }
}

async function loop(
  taskId: string,
  externalId: string,
  kind: "image" | "video",
): Promise<void> {
  const client = createComfyClient();
  const deadline = Date.now() + MAX_POLL_MS;
  let lastStatus: JobStatus = "pending";

  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);

    let snap;
    try {
      snap = await client.getJobSnapshot(externalId);
    } catch (e) {
      console.warn(
        `[provider-poller] ${taskId} transient poll error:`,
        (e as Error).message,
      );
      continue;
    }

    if (snap.status === "running" && lastStatus !== "running") {
      lastStatus = "running";
      guestDb.updateProviderJob(taskId, { status: "running" });
      jobStore.set(taskId, { status: "running", type: kind });
    } else if (snap.status === "pending") {
      lastStatus = "pending";
    }

    if (snap.status === "error") {
      settle(taskId, kind, {
        status: "error",
        error: snap.errorMessage ?? "ComfyUI job failed",
      });
      return;
    }

    if (snap.status === "done" && snap.media) {
      try {
        const copied = await client.copyOutputsToMedia(snap.media);
        if (kind === "video") {
          if (!copied.videoUrl && copied.imageUrls[0]) {
            // Some video workflows emit gif/mp4 under images — pick first media URL.
            settle(taskId, kind, {
              status: "done",
              videoUrl: copied.videoUrl ?? copied.imageUrls[0],
            });
          } else if (!copied.videoUrl) {
            settle(taskId, kind, {
              status: "error",
              error: "ComfyUI finished but returned no video output",
            });
          } else {
            settle(taskId, kind, { status: "done", videoUrl: copied.videoUrl });
          }
        } else {
          if (copied.imageUrls.length === 0) {
            settle(taskId, kind, {
              status: "error",
              error: "ComfyUI finished but returned no image output",
            });
          } else {
            settle(taskId, kind, {
              status: "done",
              imageUrl: copied.imageUrls[0],
              imageUrls: copied.imageUrls,
            });
          }
        }
      } catch (e) {
        settle(taskId, kind, {
          status: "error",
          error: (e as Error).message || "Failed to copy ComfyUI outputs",
        });
      }
      return;
    }
  }

  settle(taskId, kind, { status: "error", error: "Generation timed out" });
}
