import { describe, expect, it } from "vitest";
import { parseNvidiaSmiOutput } from "./gpu";

describe("parseNvidiaSmiOutput", () => {
  it("parses utilization and memory from nvidia-smi csv output", () => {
    expect(parseNvidiaSmiOutput("12, 24576\n")).toEqual({
      gpuUtil: 12,
      memoryUsedMb: 24576,
      memoryTotalMb: 0,
    });
  });

  it("parses total memory when requested", () => {
    expect(parseNvidiaSmiOutput("12, 24576, 32607\n")).toEqual({
      gpuUtil: 12,
      memoryUsedMb: 24576,
      memoryTotalMb: 32607,
    });
  });

  it("uses the first non-empty line for multi-gpu output", () => {
    expect(parseNvidiaSmiOutput("\n7, 1200\n99, 24000\n")).toEqual({
      gpuUtil: 7,
      memoryUsedMb: 1200,
      memoryTotalMb: 0,
    });
  });

  it("rejects malformed output", () => {
    expect(() => parseNvidiaSmiOutput("utilization, memory")).toThrow(
      "Could not parse nvidia-smi output",
    );
  });
});
