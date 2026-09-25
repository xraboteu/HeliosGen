import { randomUUID } from "node:crypto";
import type {
  JobSnapshot,
  Provider,
  ProviderModel,
  SubmitRequest,
  SubmitResult,
} from "../types";
import { aspectRatioToSize } from "../types";
import { ProviderError } from "../errors";
import { getWorkflowConfig } from "../settings";
import {
  getComfyProfiles,
  modeToTaskKind,
  profileToStoredWorkflow,
  resolveComfyProfile,
} from "../profiles";
import { applyWorkflowBindings } from "./workflow";
import { ComfyUiClient, createComfyClient } from "./client";

export function createComfyProvider(client?: ComfyUiClient): Provider {
  const c = client ?? createComfyClient();

  return {
    id: "comfyui",
    capabilities: ["image", "video"] as const,

    async isAvailable() {
      return c.isAvailable();
    },

    async listModels(): Promise<ProviderModel[]> {
      const files = await c.listWorkflowFiles();
      return files.map((name) => ({ id: name, name }));
    },

    async submit(request: SubmitRequest): Promise<SubmitResult> {
      const profiles = getComfyProfiles();
      const profileType = request.capability;
      const profile = resolveComfyProfile(profiles, {
        type: profileType,
        requestedId: request.profileId,
      });

      // Prefer profile; fall back to legacy per-taskKind workflow if no profiles.
      const config = profile
        ? profileToStoredWorkflow(profile)
        : getWorkflowConfig(request.taskKind);

      const effectiveTaskKind = profile
        ? modeToTaskKind(profile.mode)
        : request.taskKind;

      if (!config) {
        throw new ProviderError(
          "workflow_not_configured",
          `No ComfyUI profile configured for ${profileType}. Add one in Settings → Local providers.`,
          400,
        );
      }

      const needsImage =
        profile?.mode === "image-to-image" ||
        profile?.mode === "image-to-video" ||
        (!profile &&
          (effectiveTaskKind === "image.image-to-image" ||
            effectiveTaskKind === "video.image-to-video"));

      const size =
        request.width && request.height
          ? { width: request.width, height: request.height }
          : aspectRatioToSize(request.aspectRatio);

      let imageFilename: string | undefined;
      const firstImage = request.imageUrls?.[0];
      if (needsImage && firstImage && config.bindings.image) {
        imageFilename = await c.uploadGeneratedImage(firstImage);
      } else if (needsImage && firstImage && !config.bindings.image) {
        throw new ProviderError(
          "invalid_request",
          `Workflow has no image binding. Set a LoadImage node in Settings → Local model profiles.`,
          400,
        );
      }

      if (!config.bindings.prompt) {
        throw new ProviderError(
          "invalid_request",
          `Workflow has no prompt binding. Set a text node in Settings → Local model profiles.`,
          400,
        );
      }

      const seed =
        request.seed ?? Math.floor(Math.random() * 2_147_483_647);
      const duration =
        request.capability === "video" ? request.duration : undefined;

      const promptGraph = applyWorkflowBindings(config, {
        prompt: request.prompt,
        imageFilename,
        width: size.width,
        height: size.height,
        seed,
        duration,
      });

      const available = await c.isAvailable();
      if (!available) {
        throw new ProviderError(
          "unavailable",
          `ComfyUI is unreachable at the configured URL. Check Settings → Local providers.`,
          503,
        );
      }

      const externalId = await c.submitPrompt(promptGraph);
      const taskId = `comfy-${randomUUID()}`;
      return { taskId, externalId };
    },

    async getJob(externalId: string): Promise<JobSnapshot> {
      const snap = await c.getJobSnapshot(externalId);
      return {
        status: snap.status,
        errorMessage: snap.errorMessage,
      };
    },

    async getResult(externalId: string): Promise<JobSnapshot> {
      const snap = await c.getJobSnapshot(externalId);
      if (snap.status !== "done" || !snap.media) {
        return {
          status: snap.status,
          errorMessage: snap.errorMessage,
        };
      }
      const copied = await c.copyOutputsToMedia(snap.media);
      return {
        status: "done",
        imageUrls: copied.imageUrls.length > 0 ? copied.imageUrls : undefined,
        videoUrl: copied.videoUrl,
      };
    },
  };
}
