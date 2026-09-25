/** Shared provider contracts for local ComfyUI (image/video) and Ollama (chat). */

export type ProviderCapability = "image" | "video" | "chat";

export type JobStatus = "pending" | "running" | "done" | "error";

export type TaskKind =
  | "image.text-to-image"
  | "image.image-to-image"
  | "video.text-to-video"
  | "video.image-to-video";

export const TASK_KINDS: readonly TaskKind[] = [
  "image.text-to-image",
  "image.image-to-image",
  "video.text-to-video",
  "video.image-to-video",
] as const;

export const TASK_KIND_LABELS: Record<TaskKind, string> = {
  "image.text-to-image": "Image · text to image",
  "image.image-to-image": "Image · image to image",
  "video.text-to-video": "Video · text to video",
  "video.image-to-video": "Video · image to video",
};

export interface WorkflowBinding {
  nodeId: string;
  input: string;
}

export interface WorkflowBindings {
  prompt?: WorkflowBinding;
  image?: WorkflowBinding;
  width?: WorkflowBinding;
  height?: WorkflowBinding;
  seed?: WorkflowBinding;
  duration?: WorkflowBinding;
}

/** ComfyUI API-format workflow (node id → node definition). */
export type ComfyApiWorkflow = Record<
  string,
  {
    class_type: string;
    inputs: Record<string, unknown>;
    _meta?: { title?: string };
  }
>;

export interface CheckpointBinding {
  nodeId: string;
  input: string;
  value?: unknown;
}

export interface StoredWorkflowConfig {
  name: string;
  workflow: ComfyApiWorkflow;
  bindings: WorkflowBindings;
  updatedAt: string;
  /** Optional checkpoint / model name injection. */
  checkpoint?: CheckpointBinding;
}

export type ComfyProfileType = "image" | "video";

export type ComfyProfileMode =
  | "text-to-image"
  | "image-to-image"
  | "text-to-video"
  | "image-to-video";

/** User-defined ComfyUI model profile (local image/video generation). */
export interface ComfyModelProfile {
  id: string;
  name: string;
  type: ComfyProfileType;
  mode: ComfyProfileMode;
  workflow: ComfyApiWorkflow;
  bindings: WorkflowBindings;
  checkpoint?: CheckpointBinding;
  /** Aspect ratios offered in UI when width/height are bound. */
  ratios?: string[];
  /** Durations offered in UI when duration is bound. */
  durations?: number[];
  updatedAt: string;
}

export interface ProviderModel {
  id: string;
  name: string;
}

export interface SubmitImageRequest {
  capability: "image";
  taskKind: "image.text-to-image" | "image.image-to-image";
  /** Preferred ComfyUI profile id from the gallery / node picker. */
  profileId?: string;
  prompt: string;
  imageUrls?: string[];
  aspectRatio?: string;
  width?: number;
  height?: number;
  seed?: number;
}

export interface SubmitVideoRequest {
  capability: "video";
  taskKind: "video.text-to-video" | "video.image-to-video";
  /** Preferred ComfyUI profile id from the gallery / node picker. */
  profileId?: string;
  prompt: string;
  imageUrls?: string[];
  aspectRatio?: string;
  width?: number;
  height?: number;
  duration?: number;
  seed?: number;
}

export type SubmitRequest = SubmitImageRequest | SubmitVideoRequest;

export interface SubmitResult {
  taskId: string;
  externalId: string;
}

export interface JobSnapshot {
  status: JobStatus;
  errorCode?: string;
  errorMessage?: string;
  /** Local `/generated/...` URLs when done. */
  imageUrls?: string[];
  videoUrl?: string;
}

export interface Provider {
  readonly id: string;
  readonly capabilities: readonly ProviderCapability[];
  isAvailable(): Promise<boolean>;
  listModels(): Promise<ProviderModel[]>;
  submit(request: SubmitRequest): Promise<SubmitResult>;
  getJob(externalId: string): Promise<JobSnapshot>;
  getResult(externalId: string): Promise<JobSnapshot>;
}

export function deriveImageTaskKind(
  imageUrls: string[] | undefined,
): "image.text-to-image" | "image.image-to-image" {
  return imageUrls && imageUrls.length > 0
    ? "image.image-to-image"
    : "image.text-to-image";
}

export function deriveVideoTaskKind(
  startFrameUrl: string | undefined | null,
  referenceImageUrls: string[] | undefined,
): "video.text-to-video" | "video.image-to-video" {
  if (startFrameUrl || (referenceImageUrls && referenceImageUrls.length > 0)) {
    return "video.image-to-video";
  }
  return "video.text-to-video";
}

/** Map common aspect ratios to latent sizes (divisible by 8). */
export function aspectRatioToSize(
  aspectRatio: string | undefined,
  base = 1024,
): { width: number; height: number } {
  const map: Record<string, [number, number]> = {
    "1:1": [1024, 1024],
    "16:9": [1280, 720],
    "9:16": [720, 1280],
    "4:3": [1024, 768],
    "3:4": [768, 1024],
    "21:9": [1344, 576],
    "3:2": [1152, 768],
    "2:3": [768, 1152],
    auto: [base, base],
  };
  const pair = aspectRatio ? map[aspectRatio] : undefined;
  if (pair) return { width: pair[0], height: pair[1] };
  const m = aspectRatio?.match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/);
  if (m) {
    const aw = Number(m[1]);
    const ah = Number(m[2]);
    if (aw > 0 && ah > 0) {
      if (aw >= ah) {
        const width = base;
        const height = Math.max(8, Math.round((base * ah) / aw / 8) * 8);
        return { width, height };
      }
      const height = base;
      const width = Math.max(8, Math.round((base * aw) / ah / 8) * 8);
      return { width, height };
    }
  }
  return { width: base, height: base };
}
