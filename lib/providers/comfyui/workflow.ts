import type {
  ComfyApiWorkflow,
  StoredWorkflowConfig,
  WorkflowBindings,
} from "../types.ts";
import { ProviderError } from "../errors.ts";

/** Refuse UI-graph exports (`nodes` / `links`) — only API Format is accepted. */
export function assertApiFormatWorkflow(raw: unknown): ComfyApiWorkflow {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ProviderError(
      "invalid_request",
      "Workflow must be a JSON object in ComfyUI API Format.",
    );
  }
  const obj = raw as Record<string, unknown>;
  if ("nodes" in obj || "links" in obj) {
    throw new ProviderError(
      "invalid_request",
      "This looks like a ComfyUI UI graph (nodes/links). Export as API Format from ComfyUI (Save (API Format)) and try again.",
    );
  }
  for (const [id, node] of Object.entries(obj)) {
    if (!node || typeof node !== "object" || Array.isArray(node)) {
      throw new ProviderError(
        "invalid_request",
        `Workflow node "${id}" is invalid — expected { class_type, inputs }.`,
      );
    }
    const n = node as Record<string, unknown>;
    if (typeof n.class_type !== "string" || !n.inputs || typeof n.inputs !== "object") {
      throw new ProviderError(
        "invalid_request",
        `Workflow node "${id}" is missing class_type or inputs. Export as API Format.`,
      );
    }
  }
  return obj as ComfyApiWorkflow;
}

/** Suggest default bindings from common class_types. */
export function suggestBindings(workflow: ComfyApiWorkflow): WorkflowBindings {
  const bindings: WorkflowBindings = {};
  for (const [nodeId, node] of Object.entries(workflow)) {
    const ct = node.class_type;
    if (!bindings.prompt && ct === "CLIPTextEncode") {
      bindings.prompt = { nodeId, input: "text" };
    }
    if (!bindings.image && (ct === "LoadImage" || ct === "LoadImageMask")) {
      bindings.image = { nodeId, input: "image" };
    }
    if (ct === "EmptyLatentImage" || ct === "EmptySD3LatentImage") {
      if (!bindings.width) bindings.width = { nodeId, input: "width" };
      if (!bindings.height) bindings.height = { nodeId, input: "height" };
    }
    if (!bindings.seed && (ct.includes("Sampler") || ct === "KSampler" || ct === "KSamplerAdvanced")) {
      if ("seed" in node.inputs) bindings.seed = { nodeId, input: "seed" };
      else if ("noise_seed" in node.inputs) bindings.seed = { nodeId, input: "noise_seed" };
    }
  }
  return bindings;
}

export interface ApplyWorkflowValues {
  prompt?: string;
  imageFilename?: string;
  width?: number;
  height?: number;
  seed?: number;
  duration?: number;
}

function setBound(
  workflow: ComfyApiWorkflow,
  binding: { nodeId: string; input: string } | undefined,
  value: unknown,
): void {
  if (!binding || value === undefined || value === null) return;
  const node = workflow[binding.nodeId];
  if (!node) {
    throw new ProviderError(
      "invalid_request",
      `Workflow binding points to missing node "${binding.nodeId}".`,
    );
  }
  node.inputs[binding.input] = value;
}

/** Deep-clone workflow and inject bound values (including optional checkpoint). */
export function applyWorkflowBindings(
  config: StoredWorkflowConfig,
  values: ApplyWorkflowValues,
): ComfyApiWorkflow {
  const workflow = structuredClone(config.workflow);
  const b = config.bindings;
  setBound(workflow, b.prompt, values.prompt);
  setBound(workflow, b.image, values.imageFilename);
  setBound(workflow, b.width, values.width);
  setBound(workflow, b.height, values.height);
  setBound(workflow, b.seed, values.seed);
  setBound(workflow, b.duration, values.duration);
  if (config.checkpoint && config.checkpoint.value !== undefined && config.checkpoint.value !== null) {
    setBound(workflow, {
      nodeId: config.checkpoint.nodeId,
      input: config.checkpoint.input,
    }, config.checkpoint.value);
  }
  return workflow;
}

export function listWorkflowNodeOptions(workflow: ComfyApiWorkflow): Array<{
  nodeId: string;
  classType: string;
  title: string;
  inputs: string[];
}> {
  return Object.entries(workflow).map(([nodeId, node]) => ({
    nodeId,
    classType: node.class_type,
    title: node._meta?.title ?? node.class_type,
    inputs: Object.keys(node.inputs ?? {}),
  }));
}
