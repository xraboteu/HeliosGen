import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeComfyJob } from "../lib/providers/jobs.ts";

describe("normalizeComfyJob", () => {
  it("marks a prompt as pending when only in the pending queue", () => {
    const result = normalizeComfyJob(
      "abc",
      {
        queue_pending: [[1, "abc"]],
        queue_running: [],
      },
      {},
    );
    assert.equal(result.status, "pending");
    assert.equal(result.media.length, 0);
  });

  it("marks a prompt as running when in the running queue", () => {
    const result = normalizeComfyJob(
      "abc",
      {
        queue_pending: [],
        queue_running: [[0, "abc"]],
      },
      {},
    );
    assert.equal(result.status, "running");
  });

  it("returns done with image media from history outputs", () => {
    const result = normalizeComfyJob(
      "abc",
      { queue_pending: [], queue_running: [] },
      {
        abc: {
          status: { status_str: "success", completed: true },
          outputs: {
            "9": {
              images: [{ filename: "out.png", subfolder: "", type: "output" }],
            },
          },
        },
      },
    );
    assert.equal(result.status, "done");
    assert.equal(result.media.length, 1);
    assert.equal(result.media[0].kind, "image");
    assert.equal(result.media[0].filename, "out.png");
  });

  it("returns error when history reports failure", () => {
    const result = normalizeComfyJob(
      "abc",
      null,
      {
        abc: {
          status: { status_str: "error", completed: false },
          outputs: {},
        },
      },
    );
    assert.equal(result.status, "error");
  });

  it("returns error when completed with no outputs", () => {
    const result = normalizeComfyJob(
      "abc",
      null,
      {
        abc: {
          status: { status_str: "success", completed: true },
          outputs: {},
        },
      },
    );
    assert.equal(result.status, "error");
  });

  it("treats gifs ending in .mp4 as video", () => {
    const result = normalizeComfyJob(
      "v1",
      null,
      {
        v1: {
          status: { completed: true },
          outputs: {
            "12": {
              gifs: [{ filename: "clip.mp4", subfolder: "video", type: "output" }],
            },
          },
        },
      },
    );
    assert.equal(result.status, "done");
    assert.equal(result.media[0].kind, "video");
  });
});
