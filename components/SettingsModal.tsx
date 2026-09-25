"use client";

import { useCallback, useEffect, useRef, useState, startTransition } from "react";
import { useWorkflowStore } from "@/lib/store";
import type {
  CheckpointBinding,
  ComfyProfileMode,
  ComfyProfileType,
  WorkflowBinding,
  WorkflowBindings,
} from "@/lib/providers/types";

type NavId = "local-providers" | "debug";

const IS_DEBUG = process.env.NEXT_PUBLIC_DEBUG === "true";

const PROFILE_MODES: Array<{ value: ComfyProfileMode; label: string; type: ComfyProfileType }> = [
  { value: "text-to-image", label: "Text to image", type: "image" },
  { value: "image-to-image", label: "Image to image", type: "image" },
  { value: "text-to-video", label: "Text to video", type: "video" },
  { value: "image-to-video", label: "Image to video", type: "video" },
];

interface ProfileDetail {
  id: string;
  name: string;
  type: ComfyProfileType;
  mode: ComfyProfileMode;
  bindings: WorkflowBindings;
  checkpoint?: CheckpointBinding;
  ratios: string[];
  durations: number[];
  updatedAt: string;
  nodes: Array<{ nodeId: string; classType: string; title: string; inputs: string[] }>;
}

interface LocalProvidersState {
  comfyuiUrl: string;
  ollamaUrl: string;
  ollamaModel: string | null;
  profiles: ProfileDetail[];
  status: { comfyui: boolean; ollama: boolean };
  ollamaModels: Array<{ id: string; name: string }>;
}

const BINDING_FIELDS: Array<{ key: keyof WorkflowBindings; label: string }> = [
  { key: "prompt", label: "Prompt" },
  { key: "image", label: "Image" },
  { key: "width", label: "Width" },
  { key: "height", label: "Height" },
  { key: "seed", label: "Seed" },
  { key: "duration", label: "Duration" },
];

interface SettingsModalProps {
  onClose: () => void;
}

function StatusDot({ ok }: { ok: boolean | null }) {
  const color =
    ok === null ? "rgba(255,255,255,0.25)" : ok ? "rgba(74,222,128,0.9)" : "rgba(239,68,68,0.9)";
  return (
    <span
      style={{
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: color,
        display: "inline-block",
        flexShrink: 0,
      }}
    />
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        color: "rgba(255,255,255,0.35)",
        marginBottom: 6,
      }}
    >
      {children}
    </div>
  );
}

function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      style={{
        width: "100%",
        padding: "9px 12px",
        borderRadius: 8,
        border: "1px solid rgba(255,255,255,0.1)",
        background: "rgba(255,255,255,0.04)",
        color: "rgba(255,255,255,0.9)",
        fontSize: 13,
        outline: "none",
        ...((props.style as object) ?? {}),
      }}
    />
  );
}

function PrimaryButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "8px 14px",
        borderRadius: 8,
        border: "1px solid rgba(255,255,255,0.12)",
        background: disabled ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.08)",
        color: disabled ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.9)",
        fontSize: 12,
        fontWeight: 500,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {children}
    </button>
  );
}

const selectStyle: React.CSSProperties = {
  padding: "7px 10px",
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.1)",
  background: "rgba(0,0,0,0.35)",
  color: "rgba(255,255,255,0.85)",
  fontSize: 12,
  width: "100%",
};

function ProfileEditor({
  profile,
  onChanged,
}: {
  profile: ProfileDetail;
  onChanged: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(profile.name);
  const [type, setType] = useState<ComfyProfileType>(profile.type);
  const [mode, setMode] = useState<ComfyProfileMode>(profile.mode);
  const [bindings, setBindings] = useState<WorkflowBindings>(profile.bindings);
  const [checkpoint, setCheckpoint] = useState<CheckpointBinding | undefined>(profile.checkpoint);
  const [ratiosText, setRatiosText] = useState((profile.ratios ?? []).join(", "));
  const [durationsText, setDurationsText] = useState((profile.durations ?? []).join(", "));
  const [nodes, setNodes] = useState(profile.nodes);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    startTransition(() => {
      setName(profile.name);
      setType(profile.type);
      setMode(profile.mode);
      setBindings(profile.bindings);
      setCheckpoint(profile.checkpoint);
      setRatiosText((profile.ratios ?? []).join(", "));
      setDurationsText((profile.durations ?? []).join(", "));
      setNodes(profile.nodes);
    });
  }, [profile]);

  const updateBinding = (key: keyof WorkflowBindings, patch: Partial<WorkflowBinding> | null) => {
    setBindings((prev) => {
      const next = { ...prev };
      if (!patch) {
        delete next[key];
        return next;
      }
      const current = prev[key] ?? { nodeId: nodes[0]?.nodeId ?? "", input: "" };
      next[key] = { ...current, ...patch };
      return next;
    });
  };

  const save = async (extra?: { workflowJson?: unknown; workflowName?: string }) => {
    setBusy(true);
    setError(null);
    try {
      const ratios = ratiosText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const durations = durationsText
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n) && n > 0);
      const res = await fetch("/api/settings/local-providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update-profile",
          profileId: profile.id,
          name: extra?.workflowName || name,
          type,
          mode,
          bindings,
          checkpoint: checkpoint?.nodeId ? checkpoint : null,
          ratios,
          durations,
          ...(extra?.workflowJson != null ? { workflowJson: extra.workflowJson } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save profile");
      if (data.profile?.nodes) setNodes(data.profile.nodes);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const importFile = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const text = await file.text();
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error("File is not valid JSON");
      }
      await save({ workflowJson: json, workflowName: file.name.replace(/\.json$/i, "") || name });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm(`Delete profile "${profile.name}"?`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/local-providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete-profile", profileId: profile.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Delete failed");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const modesForType = PROFILE_MODES.filter((m) => m.type === type);
  const supportsRatios = !!(bindings.width && bindings.height);
  const supportsDuration = !!bindings.duration;
  const ckNode = nodes.find((n) => n.nodeId === checkpoint?.nodeId);

  return (
    <div
      style={{
        padding: 16,
        borderRadius: 12,
        border: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(255,255,255,0.02)",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
          <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Profile name" />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <select
              value={type}
              onChange={(e) => {
                const t = e.target.value as ComfyProfileType;
                setType(t);
                const first = PROFILE_MODES.find((m) => m.type === t);
                if (first) setMode(first.value);
              }}
              style={selectStyle}
            >
              <option value="image">Image</option>
              <option value="video">Video</option>
            </select>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as ComfyProfileMode)}
              style={selectStyle}
            >
              {modesForType.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>
            Updated {new Date(profile.updatedAt).toLocaleString()} · {nodes.length} nodes
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <PrimaryButton disabled={busy} onClick={() => fileRef.current?.click()}>
            {nodes.length ? "Replace JSON" : "Import API JSON"}
          </PrimaryButton>
          <PrimaryButton disabled={busy} onClick={() => void save()}>
            {busy ? "Saving…" : "Save"}
          </PrimaryButton>
          <PrimaryButton disabled={busy} onClick={() => void remove()}>
            Delete
          </PrimaryButton>
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void importFile(f);
          e.target.value = "";
        }}
      />

      {nodes.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <FieldLabel>Bindings</FieldLabel>
          {BINDING_FIELDS.map(({ key, label }) => {
            const b = bindings[key];
            const node = nodes.find((n) => n.nodeId === b?.nodeId);
            return (
              <div
                key={key}
                style={{ display: "grid", gridTemplateColumns: "80px 1fr 1fr", gap: 8, alignItems: "center" }}
              >
                <span style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>{label}</span>
                <select
                  value={b?.nodeId ?? ""}
                  onChange={(e) => {
                    const nodeId = e.target.value;
                    if (!nodeId) {
                      updateBinding(key, null);
                      return;
                    }
                    const n = nodes.find((x) => x.nodeId === nodeId);
                    updateBinding(key, { nodeId, input: n?.inputs[0] ?? "text" });
                  }}
                  style={selectStyle}
                >
                  <option value="">— none —</option>
                  {nodes.map((n) => (
                    <option key={n.nodeId} value={n.nodeId}>
                      #{n.nodeId} {n.title}
                    </option>
                  ))}
                </select>
                <select
                  value={b?.input ?? ""}
                  disabled={!b?.nodeId}
                  onChange={(e) => updateBinding(key, { input: e.target.value })}
                  style={selectStyle}
                >
                  <option value="">— input —</option>
                  {(node?.inputs ?? []).map((inp) => (
                    <option key={inp} value={inp}>
                      {inp}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}

          <FieldLabel>Checkpoint (optional)</FieldLabel>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
            <select
              value={checkpoint?.nodeId ?? ""}
              onChange={(e) => {
                const nodeId = e.target.value;
                if (!nodeId) {
                  setCheckpoint(undefined);
                  return;
                }
                const n = nodes.find((x) => x.nodeId === nodeId);
                setCheckpoint({
                  nodeId,
                  input: n?.inputs[0] ?? "ckpt_name",
                  value: checkpoint?.value ?? "",
                });
              }}
              style={selectStyle}
            >
              <option value="">— none —</option>
              {nodes.map((n) => (
                <option key={n.nodeId} value={n.nodeId}>
                  #{n.nodeId} {n.title}
                </option>
              ))}
            </select>
            <select
              value={checkpoint?.input ?? ""}
              disabled={!checkpoint?.nodeId}
              onChange={(e) =>
                setCheckpoint((prev) => (prev ? { ...prev, input: e.target.value } : prev))
              }
              style={selectStyle}
            >
              <option value="">— input —</option>
              {(ckNode?.inputs ?? []).map((inp) => (
                <option key={inp} value={inp}>
                  {inp}
                </option>
              ))}
            </select>
            <TextInput
              value={String(checkpoint?.value ?? "")}
              disabled={!checkpoint?.nodeId}
              placeholder="ckpt / model name"
              onChange={(e) =>
                setCheckpoint((prev) => (prev ? { ...prev, value: e.target.value } : prev))
              }
            />
          </div>

          {supportsRatios && (
            <div>
              <FieldLabel>Aspect ratios (comma-separated)</FieldLabel>
              <TextInput
                value={ratiosText}
                onChange={(e) => setRatiosText(e.target.value)}
                placeholder="1:1, 16:9, 9:16"
              />
            </div>
          )}
          {supportsDuration && (
            <div>
              <FieldLabel>Durations in seconds (comma-separated)</FieldLabel>
              <TextInput
                value={durationsText}
                onChange={(e) => setDurationsText(e.target.value)}
                placeholder="4, 5, 6, 8, 10"
              />
            </div>
          )}
        </div>
      )}

      {error && <div style={{ fontSize: 12, color: "rgba(248,113,113,0.95)" }}>{error}</div>}
    </div>
  );
}

function LocalProvidersPanel() {
  const setComfyAvailable = useWorkflowStore((s) => s.setComfyAvailable);
  const setOllamaAvailable = useWorkflowStore((s) => s.setOllamaAvailable);

  const [state, setState] = useState<LocalProvidersState | null>(null);
  const [comfyUrl, setComfyUrl] = useState("");
  const [ollamaUrl, setOllamaUrlLocal] = useState("");
  const [ollamaModel, setOllamaModelLocal] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const createFileRef = useRef<HTMLInputElement>(null);
  const [createType, setCreateType] = useState<ComfyProfileType>("image");
  const [createMode, setCreateMode] = useState<ComfyProfileMode>("text-to-image");

  const load = useCallback(async () => {
    const res = await fetch("/api/settings/local-providers");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Failed to load settings");
    setState(data);
    setComfyUrl(data.comfyuiUrl ?? "");
    setOllamaUrlLocal(data.ollamaUrl ?? "");
    setOllamaModelLocal(data.ollamaModel ?? "");
    setComfyAvailable(!!data.status?.comfyui);
    setOllamaAvailable(!!data.status?.ollama);
  }, [setComfyAvailable, setOllamaAvailable]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount-time remote load
    void load().catch((e) => {
      startTransition(() => setError(e instanceof Error ? e.message : String(e)));
    });
  }, [load]);

  const saveUrls = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/settings/local-providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save-urls", comfyuiUrl: comfyUrl, ollamaUrl: ollamaUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save URLs");
      setMessage("URLs saved");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const test = async (which: "comfyui" | "ollama") => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/settings/local-providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ test: which, comfyuiUrl: comfyUrl, ollamaUrl: ollamaUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Test failed");
      setMessage(data.ok ? `${which} is reachable` : `${which} is unreachable`);
      if (which === "comfyui") setComfyAvailable(!!data.ok);
      if (which === "ollama") setOllamaAvailable(!!data.ok);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const saveModel = async (model: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/local-providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save-ollama-model", ollamaModel: model }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save model");
      setOllamaModelLocal(model);
      setMessage(`Default chat model set to ${model}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const createFromFile = async (file: File) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const text = await file.text();
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error("File is not valid JSON");
      }
      const res = await fetch("/api/settings/local-providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create-profile",
          name: file.name.replace(/\.json$/i, "") || "New profile",
          type: createType,
          mode: createMode,
          workflowJson: json,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create profile");
      setMessage(`Created profile "${data.profile?.name ?? "profile"}"`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const moveProfile = async (id: string, dir: -1 | 1) => {
    const list = state?.profiles ?? [];
    const idx = list.findIndex((p) => p.id === id);
    if (idx < 0) return;
    const j = idx + dir;
    if (j < 0 || j >= list.length) return;
    const ordered = list.map((p) => p.id);
    const tmp = ordered[idx];
    ordered[idx] = ordered[j];
    ordered[j] = tmp;
    setBusy(true);
    try {
      const res = await fetch("/api/settings/local-providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reorder-profiles", orderedIds: ordered }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Reorder failed");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!state && !error) {
    return <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 13 }}>Loading…</div>;
  }

  const createModes = PROFILE_MODES.filter((m) => m.type === createType);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      <div>
        <div style={{ fontSize: 18, fontWeight: 600, color: "rgba(255,255,255,0.92)", marginBottom: 6 }}>
          Local providers
        </div>
        <div style={{ fontSize: 13, color: "rgba(255,255,255,0.45)", lineHeight: 1.45 }}>
          Connect ComfyUI for image and video generation, and Ollama for chat. Workflows must be exported in ComfyUI API Format.
        </div>
      </div>

      <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <StatusDot ok={state?.status.comfyui ?? null} />
          <span style={{ fontSize: 14, fontWeight: 600, color: "rgba(255,255,255,0.88)" }}>ComfyUI</span>
        </div>
        <div>
          <FieldLabel>Base URL</FieldLabel>
          <TextInput value={comfyUrl} onChange={(e) => setComfyUrl(e.target.value)} placeholder="http://host.docker.internal:8188" />
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <PrimaryButton disabled={busy} onClick={() => void test("comfyui")}>Test connection</PrimaryButton>
          <PrimaryButton disabled={busy} onClick={() => void saveUrls()}>Save URLs</PrimaryButton>
        </div>
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <StatusDot ok={state?.status.ollama ?? null} />
          <span style={{ fontSize: 14, fontWeight: 600, color: "rgba(255,255,255,0.88)" }}>Ollama</span>
        </div>
        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", lineHeight: 1.45 }}>
          Ollama powers chat only. Image and video generation use ComfyUI profiles below.
        </div>
        <div>
          <FieldLabel>Base URL</FieldLabel>
          <TextInput value={ollamaUrl} onChange={(e) => setOllamaUrlLocal(e.target.value)} placeholder="http://host.docker.internal:11434" />
        </div>
        <div>
          <FieldLabel>Default chat model</FieldLabel>
          <select
            value={ollamaModel}
            onChange={(e) => void saveModel(e.target.value)}
            disabled={busy || !(state?.ollamaModels.length)}
            style={{
              width: "100%",
              padding: "9px 12px",
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.1)",
              background: "rgba(255,255,255,0.04)",
              color: "rgba(255,255,255,0.9)",
              fontSize: 13,
            }}
          >
            <option value="">Select a model…</option>
            {(state?.ollamaModels ?? []).map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
          {!(state?.ollamaModels.length) && (
            <div style={{ marginTop: 6, fontSize: 12, color: "rgba(255,255,255,0.35)" }}>
              No models listed — run ollama pull &lt;model&gt;, then refresh.
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <PrimaryButton disabled={busy} onClick={() => void test("ollama")}>Test connection</PrimaryButton>
          <PrimaryButton disabled={busy} onClick={() => void load()}>Refresh</PrimaryButton>
        </div>
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "rgba(255,255,255,0.88)" }}>
          Local model profiles
        </div>
        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", lineHeight: 1.45 }}>
          Each profile maps a ComfyUI API-format workflow to image or video generation. Gallery uses these profiles as the model list.
        </div>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            alignItems: "center",
            padding: 12,
            borderRadius: 10,
            border: "1px dashed rgba(255,255,255,0.12)",
          }}
        >
          <select
            value={createType}
            onChange={(e) => {
              const t = e.target.value as ComfyProfileType;
              setCreateType(t);
              const first = PROFILE_MODES.find((m) => m.type === t);
              if (first) setCreateMode(first.value);
            }}
            style={{ ...selectStyle, width: "auto", minWidth: 100 }}
          >
            <option value="image">Image</option>
            <option value="video">Video</option>
          </select>
          <select
            value={createMode}
            onChange={(e) => setCreateMode(e.target.value as ComfyProfileMode)}
            style={{ ...selectStyle, width: "auto", minWidth: 140 }}
          >
            {createModes.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
          <PrimaryButton disabled={busy} onClick={() => createFileRef.current?.click()}>
            New profile (import JSON)
          </PrimaryButton>
          <input
            ref={createFileRef}
            type="file"
            accept="application/json,.json"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void createFromFile(f);
              e.target.value = "";
            }}
          />
        </div>

        {(state?.profiles ?? []).length === 0 && (
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>
            No profiles yet. Import a ComfyUI API Format workflow to create one.
          </div>
        )}

        {(state?.profiles ?? []).map((p, i) => (
          <div key={p.id} style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, paddingTop: 8 }}>
              <PrimaryButton disabled={busy || i === 0} onClick={() => void moveProfile(p.id, -1)}>↑</PrimaryButton>
              <PrimaryButton
                disabled={busy || i === (state?.profiles.length ?? 0) - 1}
                onClick={() => void moveProfile(p.id, 1)}
              >
                ↓
              </PrimaryButton>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <ProfileEditor profile={p} onChanged={() => void load()} />
            </div>
          </div>
        ))}
      </section>

      {(message || error) && (
        <div style={{ fontSize: 12, color: error ? "rgba(248,113,113,0.95)" : "rgba(74,222,128,0.9)" }}>
          {error ?? message}
        </div>
      )}
    </div>
  );
}

function DebugPanel() {
  const [debugMode, setDebugMode] = useState(false);
  useEffect(() => {
    try {
      const on = localStorage.getItem("aiui-debug-mode") === "1";
      startTransition(() => setDebugMode(on));
    } catch { /* noop */ }
  }, []);
  const toggle = () => {
    const next = !debugMode;
    setDebugMode(next);
    try { localStorage.setItem("aiui-debug-mode", next ? "1" : "0"); } catch { /* noop */ }
  };
  return (
    <div>
      <div style={{ fontSize: 18, fontWeight: 600, color: "rgba(255,255,255,0.92)", marginBottom: 8 }}>Debug</div>
      <button
        type="button"
        onClick={toggle}
        style={{
          padding: "8px 14px",
          borderRadius: 8,
          border: "1px solid rgba(255,255,255,0.12)",
          background: debugMode ? "rgba(251,146,60,0.25)" : "rgba(255,255,255,0.06)",
          color: "rgba(255,255,255,0.85)",
          cursor: "pointer",
          fontSize: 13,
        }}
      >
        Dry-run generation: {debugMode ? "ON" : "OFF"}
      </button>
    </div>
  );
}

export default function SettingsModal({ onClose }: SettingsModalProps) {
  const [activeNav, setActiveNav] = useState<NavId>("local-providers");
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const nav: { id: NavId; label: string }[] = [
    { id: "local-providers", label: "Local providers" },
    ...(IS_DEBUG ? [{ id: "debug" as const, label: "Debug" }] : []),
  ];

  return (
    <>
      <style>{`
        @keyframes settingsOverlayIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes settingsModalIn {
          from { opacity: 0; transform: translate(-50%, -48%) scale(0.96); }
          to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        }
      `}</style>
      <div
        ref={overlayRef}
        onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
        style={{
          position: "fixed", inset: 0, zIndex: 9999,
          background: "rgba(0, 0, 0, 0.65)",
          backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)",
          animation: "settingsOverlayIn 180ms ease both",
        }}
      />
      <div
        id="settings-modal"
        style={{
          position: "fixed", left: "50%", top: "50%", transform: "translate(-50%, -50%)",
          zIndex: 10000, width: "min(75vw, 960px)", height: "min(75vh, 680px)",
          display: "flex", borderRadius: "18px",
          background: "rgba(10, 11, 14, 0.98)",
          border: "1px solid rgba(255,255,255,0.08)",
          boxShadow: "0 32px 80px rgba(0,0,0,0.8), 0 4px 20px rgba(0,0,0,0.5)",
          overflow: "hidden",
          animation: "settingsModalIn 220ms cubic-bezier(0.22,1,0.36,1) both",
        }}
      >
        <div style={{
          width: 200, flexShrink: 0, borderRight: "1px solid rgba(255,255,255,0.06)",
          display: "flex", flexDirection: "column", padding: "20px 12px", gap: 2,
        }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "rgba(255,255,255,0.6)", padding: "4px 10px 14px" }}>
            Settings
          </div>
          {nav.map((item) => {
            const isActive = activeNav === item.id;
            return (
              <button
                key={item.id}
                id={`settings-nav-${item.id}`}
                type="button"
                onClick={() => setActiveNav(item.id)}
                style={{
                  display: "flex", alignItems: "center", gap: 9, padding: "8px 10px",
                  borderRadius: 8, border: "none", cursor: "pointer",
                  background: isActive ? "rgba(255,255,255,0.07)" : "transparent",
                  color: isActive ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.4)",
                  fontSize: 13, fontWeight: isActive ? 500 : 400, textAlign: "left", width: "100%",
                }}
              >
                {item.label}
              </button>
            );
          })}
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden" }}>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "flex-end",
            padding: "16px 20px", borderBottom: "1px solid rgba(255,255,255,0.05)", flexShrink: 0,
          }}>
            <button
              id="settings-close"
              type="button"
              onClick={onClose}
              title="Close (Esc)"
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 28, height: 28, borderRadius: 7, border: "none", cursor: "pointer",
                background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.4)",
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "28px 28px 40px" }}>
            {activeNav === "local-providers" && <LocalProvidersPanel />}
            {activeNav === "debug" && IS_DEBUG && <DebugPanel />}
          </div>
        </div>
      </div>
    </>
  );
}
