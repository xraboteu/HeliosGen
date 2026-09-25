import { NextRequest, NextResponse } from "next/server";
import { ensureStorage } from "@/lib/storage";
import { GUEST_USER_ID } from "@/lib/guestMode";
import * as guestDb from "@/lib/guest/db";
import { getComfyProvider } from "@/lib/providers/registry";
import { deriveVideoTaskKind } from "@/lib/providers/types";
import {
  getComfyProfiles,
  modeToTaskKind,
  resolveComfyProfile,
} from "@/lib/providers/profiles";
import { isProviderError, providerErrorBody } from "@/lib/providers/errors";
import {
  pollProviderJob,
  trackProviderJob,
  resumeInFlightJobs,
} from "@/lib/providers/runner";

export const maxDuration = 1000;
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  resumeInFlightJobs();

  try {
    const body = await req.json();
    const {
      prompt,
      startFrameUrl: rawStartFrame,
      referenceImageUrls: rawRefImages = body.imageUrls || ([] as string[]),
      duration = 5,
      aspectRatio = body.aspect_ratio || "16:9",
      seed,
      debugOnly = false,
    } = body as {
      prompt?: string;
      startFrameUrl?: string;
      referenceImageUrls?: string[];
      imageUrls?: string[];
      duration?: number;
      aspectRatio?: string;
      aspect_ratio?: string;
      seed?: number;
      profileId?: string;
      modelId?: string;
      debugOnly?: boolean;
    };

    const profileId =
      (typeof body.profileId === "string" && body.profileId.trim()) ||
      (typeof body.modelId === "string" && body.modelId.trim()) ||
      undefined;

    if (debugOnly) {
      console.log("[DEBUG] generate-video payload:", JSON.stringify(body, null, 2));
      return NextResponse.json({ ok: true, debugPayload: body });
    }

    if (!prompt?.trim() && !rawStartFrame && !(rawRefImages as string[]).length) {
      return NextResponse.json(
        { error: "Prompt or a start frame / reference image is required" },
        { status: 400 },
      );
    }

    const startFrameUrl = rawStartFrame
      ? await ensureStorage(rawStartFrame, "references").catch(() => rawStartFrame)
      : undefined;

    const refImages = (
      await Promise.all(
        (rawRefImages as string[]).map((u) =>
          ensureStorage(u, "references").catch(() => null),
        ),
      )
    ).filter((u): u is string => u !== null);

    // Keep a single reference image / start frame for Comfy upload.
    const imageUrls = startFrameUrl
      ? [startFrameUrl]
      : refImages.slice(0, 1);

    const profiles = getComfyProfiles();
    const profile = resolveComfyProfile(profiles, {
      type: "video",
      requestedId: profileId,
    });

    if (!profile && profiles.filter((p) => p.type === "video").length === 0) {
      return NextResponse.json(
        {
          error:
            "No video profile configured. Create one in Settings → Local model profiles.",
        },
        { status: 400 },
      );
    }

    const taskKind = profile
      ? (modeToTaskKind(profile.mode) as "video.text-to-video" | "video.image-to-video")
      : deriveVideoTaskKind(startFrameUrl, refImages);

    const provider = getComfyProvider();

    const submitted = await provider.submit({
      capability: "video",
      taskKind,
      profileId: profile?.id ?? profileId,
      prompt: (prompt ?? "").trim(),
      imageUrls,
      aspectRatio,
      duration: Number(duration) || 5,
      seed,
    });

    trackProviderJob({
      taskId: submitted.taskId,
      externalId: submitted.externalId,
      capability: "video",
      taskKind,
      request: { prompt, aspectRatio, duration, imageUrls },
    });

    guestDb.insertGeneration({
      task_id: submitted.taskId,
      user_id: GUEST_USER_ID,
      generation_type: "video",
      status: "pending",
      prompt: prompt?.slice(0, 2000),
      aspect_ratio: aspectRatio,
      duration: Number(duration) || 5,
      reference_image_urls: imageUrls.length > 0 ? imageUrls : undefined,
      provider: "comfyui",
      external_id: submitted.externalId,
      task_kind: taskKind,
    });

    pollProviderJob(submitted.taskId, submitted.externalId, "video");

    return NextResponse.json({ taskId: submitted.taskId });
  } catch (e: unknown) {
    if (isProviderError(e)) {
      return NextResponse.json(providerErrorBody(e), { status: e.status });
    }
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[generate-video] unhandled error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
