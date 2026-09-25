import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { comfyIsAvailable, comfySubmitPrompt } from "../lib/providers/comfyui/http.ts";
import { assertApiFormatWorkflow } from "../lib/providers/comfyui/workflow.ts";
import { ProviderError } from "../lib/providers/errors.ts";

describe("ComfyUI HTTP helpers with injected fetch", () => {
  it("comfyIsAvailable returns true on /system_stats 200", async () => {
    const fetchFn = mock.fn(async () => new Response("{}", { status: 200 }));
    assert.equal(
      await comfyIsAvailable("http://comfy.test", fetchFn as unknown as typeof fetch),
      true,
    );
    const url = String(fetchFn.mock.calls[0].arguments[0]);
    assert.match(url, /\/system_stats$/);
  });

  it("comfyIsAvailable returns false on network error", async () => {
    const fetchFn = mock.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    assert.equal(
      await comfyIsAvailable("http://comfy.test", fetchFn as unknown as typeof fetch),
      false,
    );
  });

  it("comfySubmitPrompt returns prompt_id", async () => {
    const fetchFn = mock.fn(
      async () =>
        new Response(JSON.stringify({ prompt_id: "pid-1" }), { status: 200 }),
    );
    const id = await comfySubmitPrompt(
      "http://comfy.test",
      { "1": { class_type: "CLIPTextEncode", inputs: { text: "hi" } } },
      "client-1",
      fetchFn as unknown as typeof fetch,
    );
    assert.equal(id, "pid-1");
  });

  it("comfySubmitPrompt throws ProviderError on HTTP failure", async () => {
    const fetchFn = mock.fn(async () => new Response("nope", { status: 500 }));
    await assert.rejects(
      () =>
        comfySubmitPrompt(
          "http://comfy.test",
          {},
          "c",
          fetchFn as unknown as typeof fetch,
        ),
      (err: unknown) => err instanceof ProviderError && err.code === "upstream",
    );
  });
});

describe("assertApiFormatWorkflow", () => {
  it("accepts API-format nodes", () => {
    const wf = assertApiFormatWorkflow({
      "1": { class_type: "CLIPTextEncode", inputs: { text: "a" } },
    });
    assert.equal(wf["1"].class_type, "CLIPTextEncode");
  });

  it("refuses UI-graph workflows with nodes/links", () => {
    assert.throws(
      () => assertApiFormatWorkflow({ nodes: [], links: [] }),
      (err: unknown) =>
        err instanceof ProviderError && err.code === "invalid_request",
    );
  });
});
