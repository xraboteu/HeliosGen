import { randomUUID } from "node:crypto";
import type {
  ComfyApiWorkflow,
  ComfyModelProfile,
  ComfyProfileMode,
  ComfyProfileType,
  StoredWorkflowConfig,
  TaskKind,
  WorkflowBindings,
} from "./types.ts";
import { TASK_KINDS, TASK_KIND_LABELS } from "./types.ts";
import * as guestDb from "../guest/db.ts";

export {
  resolveComfyProfile,
  resolveOllamaChatModel,
  type ResolveComfyProfileOpts,
} from "./profileResolve.ts";

export const KEY_COMFYUI_PROFILES = "comfyui_profiles";

const legacyWorkflowKey = (kind: TaskKind) => `comfyui_workflow:${kind}`;

function readLegacyWorkflow(kind: TaskKind): StoredWorkflowConfig | null {
  const raw = guestDb.getAppSetting(legacyWorkflowKey(kind));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredWorkflowConfig;
  } catch {
    return null;
  }
}

export const DEFAULT_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4"] as const;
export const DEFAULT_DURATIONS = [4, 5, 6, 8, 10] as const;

export type ProfileMode = ComfyProfileMode;
export type ProfileType = ComfyProfileType;

const MODE_TO_TASK_KIND: Record<ComfyProfileMode, TaskKind> = {
  "text-to-image": "image.text-to-image",
  "image-to-image": "image.image-to-image",
  "text-to-video": "video.text-to-video",
  "image-to-video": "video.image-to-video",
};

const TASK_KIND_TO_MODE: Record<TaskKind, ComfyProfileMode> = {
  "image.text-to-image": "text-to-image",
  "image.image-to-image": "image-to-image",
  "video.text-to-video": "text-to-video",
  "video.image-to-video": "image-to-video",
};

export function modeToTaskKind(mode: ComfyProfileMode): TaskKind {
  return MODE_TO_TASK_KIND[mode];
}

export function taskKindToMode(kind: TaskKind): ComfyProfileMode {
  return TASK_KIND_TO_MODE[kind];
}

export function profileTypeFromMode(mode: ComfyProfileMode): ComfyProfileType {
  return mode.startsWith("video") ? "video" : "image";
}

export function defaultRatiosForBindings(bindings: WorkflowBindings): string[] | undefined {
  if (bindings.width && bindings.height) return [...DEFAULT_RATIOS];
  return undefined;
}

export function defaultDurationsForBindings(bindings: WorkflowBindings): number[] | undefined {
  if (bindings.duration) return [...DEFAULT_DURATIONS];
  return undefined;
}

function isValidMode(v: unknown): v is ComfyProfileMode {
  return (
    v === "text-to-image" ||
    v === "image-to-image" ||
    v === "text-to-video" ||
    v === "image-to-video"
  );
}

function isValidType(v: unknown): v is ComfyProfileType {
  return v === "image" || v === "video";
}

/** Parse and lightly validate a profiles array from JSON. */
export function parseProfiles(raw: unknown): ComfyModelProfile[] {
  if (!Array.isArray(raw)) return [];
  const out: ComfyModelProfile[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const p = item as Record<string, unknown>;
    if (typeof p.id !== "string" || !p.id.trim()) continue;
    if (typeof p.name !== "string" || !p.name.trim()) continue;
    if (!isValidType(p.type) || !isValidMode(p.mode)) continue;
    if (!p.workflow || typeof p.workflow !== "object") continue;
    const bindings = (p.bindings && typeof p.bindings === "object"
      ? p.bindings
      : {}) as WorkflowBindings;
    const checkpoint =
      p.checkpoint &&
      typeof p.checkpoint === "object" &&
      typeof (p.checkpoint as { nodeId?: unknown }).nodeId === "string" &&
      typeof (p.checkpoint as { input?: unknown }).input === "string"
        ? {
            nodeId: String((p.checkpoint as { nodeId: string }).nodeId),
            input: String((p.checkpoint as { input: string }).input),
            value: (p.checkpoint as { value?: unknown }).value,
          }
        : undefined;
    const ratios = Array.isArray(p.ratios)
      ? p.ratios.filter((r): r is string => typeof r === "string")
      : undefined;
    const durations = Array.isArray(p.durations)
      ? p.durations.filter((d): d is number => typeof d === "number" && Number.isFinite(d))
      : undefined;
    out.push({
      id: p.id,
      name: p.name,
      type: p.type,
      mode: p.mode,
      workflow: p.workflow as ComfyApiWorkflow,
      bindings,
      checkpoint,
      ratios: ratios && ratios.length > 0 ? ratios : defaultRatiosForBindings(bindings),
      durations:
        durations && durations.length > 0 ? durations : defaultDurationsForBindings(bindings),
      updatedAt:
        typeof p.updatedAt === "string" ? p.updatedAt : new Date().toISOString(),
    });
  }
  return out;
}

function migrateLegacyWorkflows(): ComfyModelProfile[] {
  const profiles: ComfyModelProfile[] = [];
  for (const kind of TASK_KINDS) {
    const cfg = readLegacyWorkflow(kind);
    if (!cfg) continue;
    const mode = taskKindToMode(kind);
    const type = profileTypeFromMode(mode);
    profiles.push({
      id: `legacy:${kind}`,
      name: cfg.name?.trim() || TASK_KIND_LABELS[kind],
      type,
      mode,
      workflow: cfg.workflow,
      bindings: cfg.bindings ?? {},
      ratios: defaultRatiosForBindings(cfg.bindings ?? {}),
      durations: defaultDurationsForBindings(cfg.bindings ?? {}),
      updatedAt: cfg.updatedAt || new Date().toISOString(),
    });
  }
  return profiles;
}

/** Load profiles; migrate legacy per-taskKind workflows once if key is absent. */
export function getComfyProfiles(): ComfyModelProfile[] {
  const raw = guestDb.getAppSetting(KEY_COMFYUI_PROFILES);
  if (raw == null) {
    const migrated = migrateLegacyWorkflows();
    guestDb.setAppSetting(KEY_COMFYUI_PROFILES, JSON.stringify(migrated));
    return migrated;
  }
  try {
    return parseProfiles(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function setComfyProfiles(profiles: ComfyModelProfile[]): void {
  guestDb.setAppSetting(KEY_COMFYUI_PROFILES, JSON.stringify(profiles));
}

export function getComfyProfileById(id: string): ComfyModelProfile | null {
  return getComfyProfiles().find((p) => p.id === id) ?? null;
}

export function profileToStoredWorkflow(profile: ComfyModelProfile): StoredWorkflowConfig {
  return {
    name: profile.name,
    workflow: profile.workflow,
    bindings: profile.bindings,
    updatedAt: profile.updatedAt,
    checkpoint: profile.checkpoint,
  };
}

export function createProfileId(): string {
  return `profile-${randomUUID()}`;
}

export interface CreateProfileInput {
  name: string;
  type: ComfyProfileType;
  mode: ComfyProfileMode;
  workflow: ComfyApiWorkflow;
  bindings?: WorkflowBindings;
  checkpoint?: ComfyModelProfile["checkpoint"];
  ratios?: string[];
  durations?: number[];
}

export function buildProfile(input: CreateProfileInput, id?: string): ComfyModelProfile {
  const bindings = input.bindings ?? {};
  return {
    id: id ?? createProfileId(),
    name: input.name.trim() || "Untitled profile",
    type: input.type,
    mode: input.mode,
    workflow: input.workflow,
    bindings,
    checkpoint: input.checkpoint,
    ratios:
      input.ratios && input.ratios.length > 0
        ? input.ratios
        : defaultRatiosForBindings(bindings),
    durations:
      input.durations && input.durations.length > 0
        ? input.durations
        : defaultDurationsForBindings(bindings),
    updatedAt: new Date().toISOString(),
  };
}

/** Public shape for Settings / Gallery (includes workflow for editors that need nodes). */
export function profilesPublicSummary(profiles: ComfyModelProfile[]) {
  return profiles.map((p) => ({
    id: p.id,
    name: p.name,
    type: p.type,
    mode: p.mode,
    bindings: p.bindings,
    checkpoint: p.checkpoint,
    ratios: p.ratios ?? [],
    durations: p.durations ?? [],
    updatedAt: p.updatedAt,
    hasWorkflow: true,
  }));
}
