/**
 * UI model shapes for Gallery / canvas.
 * Catalogs are no longer hard-coded — populate from ComfyUI profiles
 * via imageModelsFromProfiles / videoModelsFromProfiles.
 */

import type { ComfyModelProfile } from "./providers/types";

export type VideoHandle = "prompt" | "startFrame" | "endFrame" | "resource" | "videoRef" | "referenceVideo" | "audioRef";

export interface ImageModel {
  id: string;
  /** @deprecated Kept for older UI paths; same as id for local profiles. */
  apiId: string;
  name: string;
  provider: string;
  ratios: string[];
  supportsImages: boolean;
  maxImages: number;
  supportsQuality: boolean;
  mode?: string;
  textOnlyPromptMaxLength?: number;
  apiInput: {
    aspectRatioKey: string;
    imageInputKey?: string;
    promptMaxLength: number;
    qualityOptions?: string[];
  };
  azureQualityOptions?: string[];
  azureResolutionOptions?: string[];
}

export interface VideoModelMode {
  value: string;
  label: string;
}

export interface VideoModel {
  id: string;
  apiId: string;
  name: string;
  provider: string;
  ratios: string[];
  durations: number[];
  defaultDuration: number;
  defaultRatio: string;
  handles: VideoHandle[];
  requiredHandles?: VideoHandle[];
  sound: boolean;
  promptOptional?: boolean;
  supportsSeeds?: boolean;
  modes?: VideoModelMode[];
  defaultMode?: string;
  resolutions?: string[];
  defaultResolution?: string;
  maxResources?: number;
  maxReferenceVideos?: number;
  maxReferenceAudios?: number;
  resourceTagFormat?: "default" | "grok";
  apiInput: {
    aspectRatioKey?: string;
    durationKey?: string;
    durationMin: number;
    durationMax: number;
    promptMaxLength?: number;
    useKlingElements?: boolean;
    useGoogleVeo?: boolean;
    useMotionControl?: boolean;
    videoRefMaxDuration?: number;
  };
}

/** @deprecated Empty — use profiles from /api/settings/local-providers. */
export const IMAGE_MODELS: ImageModel[] = [];

/** @deprecated Empty — use profiles from /api/settings/local-providers. */
export const VIDEO_MODELS: VideoModel[] = [];

export function imageModelsFromProfiles(
  profiles: Array<Pick<ComfyModelProfile, "id" | "name" | "type" | "mode" | "bindings" | "ratios">>,
): ImageModel[] {
  return profiles
    .filter((p) => p.type === "image")
    .map((p) => {
      const needsImage = p.mode === "image-to-image";
      const ratios =
        p.ratios && p.ratios.length > 0
          ? p.ratios
          : p.bindings.width && p.bindings.height
            ? ["1:1", "16:9", "9:16", "4:3", "3:4"]
            : ["1:1"];
      return {
        id: p.id,
        apiId: p.id,
        name: p.name,
        provider: "ComfyUI",
        ratios,
        supportsImages: needsImage || !!p.bindings.image,
        maxImages: needsImage || p.bindings.image ? 1 : 0,
        supportsQuality: false,
        mode: p.mode,
        apiInput: {
          aspectRatioKey: "aspect_ratio",
          imageInputKey: p.bindings.image ? "image_urls" : undefined,
          promptMaxLength: 20000,
        },
      };
    });
}

export function videoModelsFromProfiles(
  profiles: Array<
    Pick<ComfyModelProfile, "id" | "name" | "type" | "mode" | "bindings" | "ratios" | "durations">
  >,
): VideoModel[] {
  return profiles
    .filter((p) => p.type === "video")
    .map((p) => {
      const needsStart = p.mode === "image-to-video";
      const ratios =
        p.ratios && p.ratios.length > 0
          ? p.ratios
          : p.bindings.width && p.bindings.height
            ? ["16:9", "9:16", "1:1", "4:3", "3:4"]
            : ["16:9"];
      const durations =
        p.durations && p.durations.length > 0
          ? p.durations
          : p.bindings.duration
            ? [4, 5, 6, 8, 10]
            : [];
      const handles: VideoHandle[] = ["prompt"];
      if (needsStart || p.bindings.image) handles.push("startFrame");
      return {
        id: p.id,
        apiId: p.id,
        name: p.name,
        provider: "ComfyUI",
        ratios,
        durations,
        defaultDuration: durations[0] ?? 5,
        defaultRatio: ratios[0] ?? "16:9",
        handles,
        requiredHandles: needsStart ? ["startFrame"] : undefined,
        sound: false,
        promptOptional: false,
        apiInput: {
          aspectRatioKey: "aspect_ratio",
          durationKey: p.bindings.duration ? "duration" : undefined,
          durationMin: durations[0] ?? 0,
          durationMax: durations[durations.length - 1] ?? 0,
          promptMaxLength: 20000,
        },
      };
    });
}
