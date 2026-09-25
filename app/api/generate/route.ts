import { NextRequest, NextResponse } from "next/server";
import { ensureStorage } from "@/lib/storage";
import { GUEST_USER_ID } from "@/lib/guestMode";
import * as guestDb from "@/lib/guest/db";
import { getComfyProvider } from "@/lib/providers/registry";
import { deriveImageTaskKind } from "@/lib/providers/types";
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

async function resolveImages(imageUrls: string[]): Promise<string[]> {
  const resolved = await Promise.all(
    imageUrls.slice(0, 14).map((u) => ensureStorage(u, "references").catch(() => null)),
  );
  return resolved.filter((u): u is string => u !== null);
}

export async function POST(req: NextRequest) {
  resumeInFlightJobs();

  try {
    const body = (await req.json()) as {
      prompt?: string;
      imageUrls?: string[];
      aspectRatio?: string;
      width?: number;
      height?: number;
      seed?: number;
      profileId?: string;
      modelId?: string;
      debugOnly?: boolean;
    };

    const {
      prompt,
      imageUrls = [],
      aspectRatio = "1:1",
      width,
      height,
      seed,
      debugOnly,
    } = body;

    const profileId = body.profileId?.trim() || body.modelId?.trim() || undefined;

    if (debugOnly) {
      console.log("[DEBUG] generate payload:", JSON.stringify(body, null, 2));
      return NextResponse.json({ ok: true });
    }

    if (!prompt?.trim()) {
      return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
    }

    const localImages = await resolveImages(imageUrls);
    const profiles = getComfyProfiles();
    const profile = resolveComfyProfile(profiles, {
      type: "image",
      requestedId: profileId,
    });

    if (!profile && profiles.filter((p) => p.type === "image").length === 0) {
      return NextResponse.json(
        {
          error:
            "No image profile configured. Create one in Settings → Local model profiles.",
        },
        { status: 400 },
      );
    }

    const taskKind = profile
      ? (modeToTaskKind(profile.mode) as "image.text-to-image" | "image.image-to-image")
      : deriveImageTaskKind(localImages);

    const provider = getComfyProvider();

    const submitted = await provider.submit({
      capability: "image",
      taskKind,
      profileId: profile?.id ?? profileId,
      prompt: prompt.trim(),
      imageUrls: localImages,
      aspectRatio,
      width,
      height,
      seed,
    });

    trackProviderJob({
      taskId: submitted.taskId,
      externalId: submitted.externalId,
      capability: "image",
      taskKind,
      request: { prompt, aspectRatio, imageUrls: localImages },
    });

    guestDb.insertGeneration({
      task_id: submitted.taskId,
      user_id: GUEST_USER_ID,
      generation_type: "image",
      status: "pending",
      prompt: prompt.slice(0, 2000),
      aspect_ratio: aspectRatio,
      reference_image_urls: localImages.length > 0 ? localImages : undefined,
      provider: "comfyui",
      external_id: submitted.externalId,
      task_kind: taskKind,
    });

    pollProviderJob(submitted.taskId, submitted.externalId, "image");

    return NextResponse.json({
      taskId: submitted.taskId,
      referenceImageUrls: localImages,
    });
  } catch (e: unknown) {
    if (isProviderError(e)) {
      return NextResponse.json(providerErrorBody(e), { status: e.status });
    }
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
