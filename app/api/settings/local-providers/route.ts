import { NextRequest, NextResponse } from "next/server";
import {
  getLocalProviderSettingsPublic,
  setComfyUiUrl,
  setOllamaUrl,
  setOllamaModel,
} from "@/lib/providers/settings";
import {
  assertApiFormatWorkflow,
  suggestBindings,
  listWorkflowNodeOptions,
} from "@/lib/providers/comfyui/workflow";
import type {
  ComfyModelProfile,
  ComfyProfileMode,
  ComfyProfileType,
  WorkflowBindings,
} from "@/lib/providers/types";
import {
  buildProfile,
  getComfyProfiles,
  setComfyProfiles,
  profilesPublicSummary,
} from "@/lib/providers/profiles";
import { createComfyClient } from "@/lib/providers/comfyui/client";
import { createOllamaClient } from "@/lib/providers/ollama/client";
import { isProviderError, providerErrorBody } from "@/lib/providers/errors";

export const dynamic = "force-dynamic";

function profileDetail(p: ComfyModelProfile) {
  return {
    id: p.id,
    name: p.name,
    type: p.type,
    mode: p.mode,
    bindings: p.bindings,
    checkpoint: p.checkpoint,
    ratios: p.ratios ?? [],
    durations: p.durations ?? [],
    updatedAt: p.updatedAt,
    nodes: listWorkflowNodeOptions(p.workflow),
  };
}

export async function GET() {
  try {
    const settings = getLocalProviderSettingsPublic();
    const [comfyOk, ollamaOk] = await Promise.all([
      createComfyClient({ baseUrl: settings.comfyuiUrl }).isAvailable(),
      createOllamaClient({ baseUrl: settings.ollamaUrl }).isAvailable(),
    ]);

    let ollamaModels: Array<{ id: string; name: string }> = [];
    if (ollamaOk) {
      try {
        ollamaModels = await createOllamaClient({ baseUrl: settings.ollamaUrl }).listModels();
      } catch {
        ollamaModels = [];
      }
    }

    let comfyWorkflowFiles: string[] = [];
    if (comfyOk) {
      try {
        comfyWorkflowFiles = await createComfyClient({
          baseUrl: settings.comfyuiUrl,
        }).listWorkflowFiles();
      } catch {
        comfyWorkflowFiles = [];
      }
    }

    const profiles = getComfyProfiles().map(profileDetail);

    return NextResponse.json({
      ...settings,
      profiles,
      status: { comfyui: comfyOk, ollama: ollamaOk },
      ollamaModels,
      comfyWorkflowFiles,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

function isMode(v: unknown): v is ComfyProfileMode {
  return (
    v === "text-to-image" ||
    v === "image-to-image" ||
    v === "text-to-video" ||
    v === "image-to-video"
  );
}

function isType(v: unknown): v is ComfyProfileType {
  return v === "image" || v === "video";
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      action?: string;
      comfyuiUrl?: string;
      ollamaUrl?: string;
      ollamaModel?: string;
      test?: "comfyui" | "ollama";
      profileId?: string;
      name?: string;
      type?: ComfyProfileType;
      mode?: ComfyProfileMode;
      workflowJson?: unknown;
      bindings?: WorkflowBindings;
      checkpoint?: ComfyModelProfile["checkpoint"] | null;
      ratios?: string[];
      durations?: number[];
      orderedIds?: string[];
    };

    if (body.test === "comfyui") {
      const url = body.comfyuiUrl?.trim() || undefined;
      const ok = await createComfyClient(url ? { baseUrl: url } : undefined).isAvailable();
      return NextResponse.json({ ok });
    }
    if (body.test === "ollama") {
      const url = body.ollamaUrl?.trim() || undefined;
      const ok = await createOllamaClient(url ? { baseUrl: url } : undefined).isAvailable();
      return NextResponse.json({ ok });
    }

    if (body.action === "save-urls") {
      if (typeof body.comfyuiUrl === "string") setComfyUiUrl(body.comfyuiUrl);
      if (typeof body.ollamaUrl === "string") setOllamaUrl(body.ollamaUrl);
      return NextResponse.json({ ok: true, ...getLocalProviderSettingsPublic() });
    }

    if (body.action === "save-ollama-model") {
      if (!body.ollamaModel?.trim()) {
        return NextResponse.json({ error: "ollamaModel is required" }, { status: 400 });
      }
      setOllamaModel(body.ollamaModel);
      return NextResponse.json({ ok: true, ollamaModel: body.ollamaModel.trim() });
    }

    if (body.action === "create-profile") {
      if (!isType(body.type) || !isMode(body.mode)) {
        return NextResponse.json(
          { error: "type and mode are required (image|video + mode)" },
          { status: 400 },
        );
      }
      if (body.workflowJson == null) {
        return NextResponse.json({ error: "workflowJson is required" }, { status: 400 });
      }
      const workflow = assertApiFormatWorkflow(body.workflowJson);
      const suggested = suggestBindings(workflow);
      const bindings: WorkflowBindings = {
        ...suggested,
        ...(body.bindings ?? {}),
      };
      const profile = buildProfile({
        name: body.name?.trim() || "New profile",
        type: body.type,
        mode: body.mode,
        workflow,
        bindings,
        checkpoint: body.checkpoint ?? undefined,
        ratios: body.ratios,
        durations: body.durations,
      });
      const profiles = getComfyProfiles();
      profiles.push(profile);
      setComfyProfiles(profiles);
      return NextResponse.json({
        ok: true,
        profile: profileDetail(profile),
        profiles: profilesPublicSummary(profiles),
        suggested,
      });
    }

    if (body.action === "update-profile") {
      const id = body.profileId?.trim();
      if (!id) {
        return NextResponse.json({ error: "profileId is required" }, { status: 400 });
      }
      const profiles = getComfyProfiles();
      const idx = profiles.findIndex((p) => p.id === id);
      if (idx < 0) {
        return NextResponse.json({ error: "Profile not found" }, { status: 404 });
      }
      const existing = profiles[idx];
      let workflow = existing.workflow;
      let bindings = existing.bindings;
      if (body.workflowJson != null) {
        workflow = assertApiFormatWorkflow(body.workflowJson);
        const suggested = suggestBindings(workflow);
        bindings = { ...suggested, ...(body.bindings ?? existing.bindings) };
      } else if (body.bindings) {
        bindings = body.bindings;
      }
      const next: ComfyModelProfile = {
        ...existing,
        name: body.name?.trim() || existing.name,
        type: isType(body.type) ? body.type : existing.type,
        mode: isMode(body.mode) ? body.mode : existing.mode,
        workflow,
        bindings,
        checkpoint:
          body.checkpoint === null
            ? undefined
            : body.checkpoint !== undefined
              ? body.checkpoint
              : existing.checkpoint,
        ratios: body.ratios ?? existing.ratios,
        durations: body.durations ?? existing.durations,
        updatedAt: new Date().toISOString(),
      };
      profiles[idx] = next;
      setComfyProfiles(profiles);
      return NextResponse.json({
        ok: true,
        profile: profileDetail(next),
        profiles: profilesPublicSummary(profiles),
      });
    }

    if (body.action === "delete-profile") {
      const id = body.profileId?.trim();
      if (!id) {
        return NextResponse.json({ error: "profileId is required" }, { status: 400 });
      }
      const profiles = getComfyProfiles().filter((p) => p.id !== id);
      setComfyProfiles(profiles);
      return NextResponse.json({
        ok: true,
        profiles: profilesPublicSummary(profiles),
      });
    }

    if (body.action === "reorder-profiles") {
      const orderedIds = body.orderedIds;
      if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
        return NextResponse.json({ error: "orderedIds is required" }, { status: 400 });
      }
      const current = getComfyProfiles();
      const byId = new Map(current.map((p) => [p.id, p]));
      const next: ComfyModelProfile[] = [];
      for (const id of orderedIds) {
        const p = byId.get(id);
        if (p) {
          next.push(p);
          byId.delete(id);
        }
      }
      for (const p of byId.values()) next.push(p);
      setComfyProfiles(next);
      return NextResponse.json({
        ok: true,
        profiles: profilesPublicSummary(next),
      });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e: unknown) {
    if (isProviderError(e)) {
      return NextResponse.json(providerErrorBody(e), { status: e.status });
    }
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
