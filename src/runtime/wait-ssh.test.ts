import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../utils/process.js", () => ({
  execCapture: vi.fn(),
  execInherit: vi.fn().mockReturnValue(0),
}));

vi.mock("../utils/logger.js", () => ({
  log: vi.fn(),
}));

import { waitForSsh } from "./lima.js";
import { execCapture } from "../utils/process.js";
import { log } from "../utils/logger.js";

describe("waitForSsh", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
  });

  it("returns immediately when SSH is ready on first try", async () => {
    vi.mocked(execCapture).mockReturnValue({ status: 0, stdout: "", stderr: "" });

    const promise = waitForSsh("test-vm", 30);
    await promise;

    expect(execCapture).toHaveBeenCalledTimes(1);
    expect(execCapture).toHaveBeenCalledWith("limactl", ["shell", "test-vm", "--", "true"]);
  });

  it("retries on failure and succeeds on 4th attempt", async () => {
    vi.mocked(execCapture)
      .mockReturnValueOnce({ status: 1, stdout: "", stderr: "err" })
      .mockReturnValueOnce({ status: 1, stdout: "", stderr: "err" })
      .mockReturnValueOnce({ status: 1, stdout: "", stderr: "err" })
      .mockReturnValueOnce({ status: 0, stdout: "", stderr: "" });

    const promise = waitForSsh("test-vm", 30);

    // Advance through 3 setTimeout intervals (1s each)
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);

    await promise;

    expect(execCapture).toHaveBeenCalledTimes(4);
  });

  it("does not throw on timeout, logs warning instead", async () => {
    vi.mocked(execCapture).mockReturnValue({ status: 1, stdout: "", stderr: "err" });

    // Use a very short timeout (1 second)
    vi.useRealTimers();
    await waitForSsh("test-vm", 1);

    // Should have logged a warning
    expect(log).toHaveBeenCalledWith(expect.stringContaining("timeout"));
  });
});
