import { NextRequest, NextResponse } from "next/server";
import { jobStore } from "@/lib/jobStore";
import {
  resumeProviderJob,
  resumeInFlightJobs,
} from "@/lib/providers/runner";
import * as guestDb from "@/lib/guest/db";

function recoverJob(taskId: string): "done" | "error" | "pending" | "not_found" {
  const gen = guestDb.recoverJob(taskId);
  if (!gen) return "not_found";
  if (gen.status === "done") {
    const result = gen.video_url
      ? { status: "done" as const, videoUrl: gen.video_url }
      : {
          status: "done" as const,
          imageUrl: gen.image_url ?? undefined,
          imageUrls: gen.image_urls ?? undefined,
        };
    jobStore.set(taskId, result);
    return "done";
  }
  if (gen.status === "error") {
    jobStore.set(taskId, {
      status: "error",
      error: gen.error_msg ?? "Generation failed",
    });
    return "error";
  }
  return "pending";
}

export async function GET(req: NextRequest) {
  resumeInFlightJobs();

  const taskId = req.nextUrl.searchParams.get("taskId");
  if (!taskId) {
    return NextResponse.json({ error: "taskId is required" }, { status: 400 });
  }

  const result = jobStore.get(taskId);

  if (result) {
    if (result.status === "pending" || result.status === "running") {
      const kind = result.type === "video" ? "video" : "image";
      resumeProviderJob(taskId, kind);
    }
    return NextResponse.json(result);
  }

  const recovered = recoverJob(taskId);

  if (recovered === "done" || recovered === "error") {
    return NextResponse.json(jobStore.get(taskId)!);
  }

  if (recovered === "pending") {
    const row = guestDb.getProviderJob(taskId);
    if (row?.external_id) {
      resumeProviderJob(taskId, row.capability === "video" ? "video" : "image");
    }
    return NextResponse.json({ status: "pending" });
  }

  return NextResponse.json({ status: "not_found" });
}
