import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolveComfyProfile,
  resolveOllamaChatModel,
} from "../lib/providers/profileResolve.ts";
import type { ComfyModelProfile } from "../lib/providers/types.ts";

const minimalWorkflow = {
  "1": { class_type: "CLIPTextEncode", inputs: { text: "" } },
};

function profile(
  partial: Partial<ComfyModelProfile> & Pick<ComfyModelProfile, "id" | "type" | "mode">,
): ComfyModelProfile {
  return {
    name: partial.name ?? partial.id,
    workflow: partial.workflow ?? (minimalWorkflow as ComfyModelProfile["workflow"]),
    bindings: partial.bindings ?? { prompt: { nodeId: "1", input: "text" } },
    updatedAt: partial.updatedAt ?? "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

describe("resolveComfyProfile", () => {
  const profiles = [
    profile({
      id: "img-a",
      name: "SDXL T2I",
      type: "image",
      mode: "text-to-image",
      workflow: {
        ...minimalWorkflow,
        "2": { class_type: "EmptyLatentImage", inputs: { width: 1024, height: 1024 } },
      } as ComfyModelProfile["workflow"],
    }),
    profile({
      id: "img-b",
      name: "Img2Img",
      type: "image",
      mode: "image-to-image",
    }),
    profile({
      id: "vid-a",
      name: "T2V",
      type: "video",
      mode: "text-to-video",
    }),
  ];

  it("resolves a profile by id with matching type", () => {
    const got = resolveComfyProfile(profiles, {
      type: "image",
      requestedId: "img-b",
    });
    assert.equal(got?.id, "img-b");
    assert.equal(got?.mode, "image-to-image");
    assert.ok(got?.workflow["1"]);
  });

  it("falls back from legacy nano-banana-2 to the first compatible image profile", () => {
    const got = resolveComfyProfile(profiles, {
      type: "image",
      requestedId: "nano-banana-2",
    });
    assert.equal(got?.id, "img-a");
  });

  it("falls back from legacy kling-3.0 to the first compatible video profile", () => {
    const got = resolveComfyProfile(profiles, {
      type: "video",
      requestedId: "kling-3.0",
    });
    assert.equal(got?.id, "vid-a");
  });

  it("returns null when no compatible image profile exists", () => {
    const got = resolveComfyProfile([], {
      type: "image",
      requestedId: "nano-banana-2",
    });
    assert.equal(got, null);
  });

  it("returns null when no compatible video profile exists", () => {
    const onlyImage = [profiles[0]];
    const got = resolveComfyProfile(onlyImage, {
      type: "video",
      requestedId: "kling-3.0",
    });
    assert.equal(got, null);
  });

  it("honors mode filter when provided", () => {
    const got = resolveComfyProfile(profiles, {
      type: "image",
      requestedId: "img-a",
      mode: "image-to-image",
    });
    // id matches type but not mode → fall through to first compatible mode
    assert.equal(got?.id, "img-b");
  });
});

describe("resolveOllamaChatModel", () => {
  it("keeps a listed Ollama model name unchanged", () => {
    const got = resolveOllamaChatModel(
      "llama3.2:latest",
      ["llama3.2:latest", "mistral"],
      "mistral",
    );
    assert.equal(got, "llama3.2:latest");
  });

  it("falls back from a cloud id to the stored default when listed", () => {
    const got = resolveOllamaChatModel(
      "claude-sonnet-4-6",
      ["llama3.2:latest", "mistral"],
      "mistral",
    );
    assert.equal(got, "mistral");
  });

  it("falls back from a cloud id to the first available model", () => {
    const got = resolveOllamaChatModel(
      "claude-sonnet-4-6",
      ["llama3.2:latest", "mistral"],
      "not-installed",
    );
    assert.equal(got, "llama3.2:latest");
  });

  it("returns null when the available list is empty", () => {
    const got = resolveOllamaChatModel("claude-sonnet-4-6", [], "mistral");
    assert.equal(got, null);
  });
});

describe("resolveOllamaChatModel empty list", () => {
  it("returns null when the available list is empty", () => {
    const got = resolveOllamaChatModel("claude-sonnet-4-6", [], "mistral");
    assert.equal(got, null);
  });
});
