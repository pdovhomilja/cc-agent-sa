import { describe, it, expect, vi, beforeEach } from "vitest";
import { postToX, XurlError } from "../src/publisher/xurl.js";

vi.mock("node:child_process");

const XURL_PATH = "/usr/local/bin/xurl";

describe("postToX", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("builds correct argv and returns tweetId + url on success", async () => {
    const { execFile } = await import("node:child_process");
    const mockExecFile = vi.mocked(execFile);
    mockExecFile.mockImplementation((_cmd, _args, _opts, callback: any) => {
      callback(null, JSON.stringify({ data: { id: "123456789" } }), "");
      return {} as any;
    });

    const result = await postToX({ text: "Hello world" }, { xurlPath: XURL_PATH });

    expect(result).toEqual({
      tweetId: "123456789",
      url: "https://x.com/i/web/status/123456789",
    });

    expect(mockExecFile).toHaveBeenCalledWith(
      XURL_PATH,
      [
        "-X", "POST",
        "-H", "content-type: application/json",
        "-d", JSON.stringify({ text: "Hello world" }),
        "/2/tweets",
      ],
      expect.objectContaining({ timeout: 20_000 }),
      expect.any(Function),
    );
  });

  it("throws XurlError on non-zero exit", async () => {
    const { execFile } = await import("node:child_process");
    const mockExecFile = vi.mocked(execFile);
    mockExecFile.mockImplementation((_cmd, _args, _opts, callback: any) => {
      const err = Object.assign(new Error("Command failed"), { code: 1 });
      callback(err, "", "some stderr output");
      return {} as any;
    });

    await expect(postToX({ text: "Hello" }, { xurlPath: XURL_PATH })).rejects.toBeInstanceOf(XurlError);
  });

  it("throws XurlError when API returns errors array", async () => {
    const { execFile } = await import("node:child_process");
    const mockExecFile = vi.mocked(execFile);
    mockExecFile.mockImplementation((_cmd, _args, _opts, callback: any) => {
      callback(
        null,
        JSON.stringify({ errors: [{ message: "Duplicate content" }, { message: "Rate limit" }] }),
        "",
      );
      return {} as any;
    });

    const promise = postToX({ text: "Hello" }, { xurlPath: XURL_PATH });
    await expect(promise).rejects.toBeInstanceOf(XurlError);
    await expect(promise).rejects.toThrow("Duplicate content");
  });

  it("rejects text over 280 chars", async () => {
    const longText = "a".repeat(281);
    await expect(postToX({ text: longText }, { xurlPath: XURL_PATH })).rejects.toBeInstanceOf(XurlError);
  });
});
