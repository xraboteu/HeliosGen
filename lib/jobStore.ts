/**
 * Job store façade over SQLite `provider_jobs`.
 * Keeps the same shape the generate / job-status / job-stream routes expect.
 */
import * as guestDb from "./guest/db";

export type JobResult =
  | { status: "pending"; type?: "image" | "video"; userId?: string }
  | { status: "running"; type?: "image" | "video"; userId?: string }
  | { status: "done"; imageUrl?: string; imageUrls?: string[]; videoUrl?: string }
  | { status: "error"; error: string };

function rowToResult(row: guestDb.ProviderJobRow): JobResult {
  const type = row.capability === "video" ? "video" : "image";
  if (row.status === "done") {
    let imageUrls: string[] | undefined;
    let imageUrl: string | undefined;
    let videoUrl: string | undefined;
    if (row.result_json) {
      try {
        const parsed = JSON.parse(row.result_json) as {
          imageUrls?: string[];
          imageUrl?: string;
          videoUrl?: string;
        };
        imageUrls = parsed.imageUrls;
        imageUrl = parsed.imageUrl ?? parsed.imageUrls?.[0];
        videoUrl = parsed.videoUrl;
      } catch {
        /* ignore */
      }
    }
    return { status: "done", imageUrl, imageUrls, videoUrl };
  }
  if (row.status === "error") {
    return { status: "error", error: row.error_message ?? "Generation failed" };
  }
  if (row.status === "running") {
    return { status: "running", type };
  }
  return { status: "pending", type };
}

export const jobStore = {
  get(taskId: string): JobResult | undefined {
    const row = guestDb.getProviderJob(taskId);
    return row ? rowToResult(row) : undefined;
  },

  set(taskId: string, result: JobResult): void {
    const existing = guestDb.getProviderJob(taskId);
    if (!existing) {
      const capability =
        result.status === "pending" || result.status === "running"
          ? result.type === "video"
            ? "video"
            : "image"
          : "image";
      guestDb.insertProviderJob({
        id: taskId,
        provider: "comfyui",
        capability,
        status: result.status,
        error_message: result.status === "error" ? result.error : null,
        result_json:
          result.status === "done"
            ? JSON.stringify({
                imageUrl: result.imageUrl,
                imageUrls: result.imageUrls,
                videoUrl: result.videoUrl,
              })
            : null,
      });
      return;
    }

    if (result.status === "done") {
      guestDb.updateProviderJob(taskId, {
        status: "done",
        error_code: null,
        error_message: null,
        result_json: JSON.stringify({
          imageUrl: result.imageUrl,
          imageUrls: result.imageUrls,
          videoUrl: result.videoUrl,
        }),
      });
      return;
    }
    if (result.status === "error") {
      guestDb.updateProviderJob(taskId, {
        status: "error",
        error_message: result.error,
      });
      return;
    }
    guestDb.updateProviderJob(taskId, { status: result.status });
  },
};
