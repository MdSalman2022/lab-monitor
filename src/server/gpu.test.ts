import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type LabScheduleManagerDatabase } from "./db";
import {
  getGpuDaySeries,
  getGpuWeeklyOverview,
  inferGpuProcessKind,
  insertGpuProcessSamples,
  insertGpuSample,
  parseNvidiaSmiComputeAppsOutput,
  parseNvidiaSmiOutput,
} from "./gpu";

const tempDirs: string[] = [];

function testDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lab-schedule-manager-gpu-"));
  tempDirs.push(dir);
  return openDatabase(path.join(dir, "test.sqlite"));
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function close(db: LabScheduleManagerDatabase) {
  db.close();
}

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

describe("parseNvidiaSmiComputeAppsOutput", () => {
  it("parses GPU compute process rows from nvidia-smi csv output", () => {
    expect(
      parseNvidiaSmiComputeAppsOutput(
        "1234, C:\\Users\\lab\\.conda\\envs\\torch\\python.exe, 8192\n5678, chrome.exe, 256\n",
      ),
    ).toEqual([
      {
        pid: 1234,
        processName: "C:\\Users\\lab\\.conda\\envs\\torch\\python.exe",
        usedMemoryMb: 8192,
      },
      {
        pid: 5678,
        processName: "chrome.exe",
        usedMemoryMb: 256,
      },
    ]);
  });

  it("returns an empty list when no compute processes are running", () => {
    expect(parseNvidiaSmiComputeAppsOutput("")).toEqual([]);
    expect(
      parseNvidiaSmiComputeAppsOutput("No running processes found\n"),
    ).toEqual([]);
  });

  it("rejects malformed compute process rows", () => {
    expect(() => parseNvidiaSmiComputeAppsOutput("python.exe, nope")).toThrow(
      "Could not parse nvidia-smi compute process output",
    );
  });
});

describe("inferGpuProcessKind", () => {
  it("marks a Python process with meaningful GPU memory as likely ML/DL", () => {
    expect(
      inferGpuProcessKind({
        pid: 1234,
        processName: "python.exe",
        commandLine: "python train.py --model resnet",
        usedMemoryMb: 4096,
      }),
    ).toMatchObject({
      isPython: true,
      isLikelyMl: true,
      reason: "python_gpu_memory",
    });
  });

  it("uses ML framework keywords from command lines", () => {
    expect(
      inferGpuProcessKind({
        pid: 1234,
        processName: "python.exe",
        commandLine: "python -m torch.distributed.run train.py",
        usedMemoryMb: 256,
      }),
    ).toMatchObject({
      isPython: true,
      isLikelyMl: true,
      reason: "ml_keyword",
    });
  });

  it("does not treat small browser GPU use as ML/DL work", () => {
    expect(
      inferGpuProcessKind({
        pid: 5678,
        processName: "chrome.exe",
        commandLine: "chrome.exe --type=gpu-process",
        usedMemoryMb: 128,
      }),
    ).toMatchObject({
      isPython: false,
      isLikelyMl: false,
      reason: "not_ml_process",
    });
  });
});

describe("getGpuDaySeries", () => {
  it("buckets today GPU, VRAM, and ML/DL process signal", () => {
    const db = testDb();
    const firstBucket = new Date(2026, 5, 23, 9, 5);
    const secondBucket = new Date(2026, 5, 23, 9, 20);

    insertGpuSample(
      {
        gpuUtil: 20,
        memoryUsedMb: 2000,
        memoryTotalMb: 8000,
        sampledAt: firstBucket,
      },
      db,
    );
    insertGpuSample(
      {
        gpuUtil: 40,
        memoryUsedMb: 4000,
        memoryTotalMb: 8000,
        sampledAt: firstBucket,
      },
      db,
    );
    insertGpuSample(
      {
        gpuUtil: 60,
        memoryUsedMb: 6000,
        memoryTotalMb: 8000,
        sampledAt: secondBucket,
      },
      db,
    );
    insertGpuProcessSamples(
      [
        {
          pid: 1234,
          processName: "python.exe",
          commandLine: "python -m torch.distributed.run train.py",
          usedMemoryMb: 4096,
          sampledAt: firstBucket,
        },
        {
          pid: 5678,
          processName: "chrome.exe",
          commandLine: "chrome.exe --type=gpu-process",
          usedMemoryMb: 256,
          sampledAt: firstBucket,
        },
      ],
      db,
    );

    const series = getGpuDaySeries(new Date(2026, 5, 23, 9, 25), db, 15);
    const nineAmBucket = series[36];
    const nineFifteenBucket = series[37];

    expect(nineAmBucket).toMatchObject({
      gpuUtil: 30,
      memoryPercent: 37.5,
      mlPercent: 50,
    });
    expect(nineFifteenBucket).toMatchObject({
      gpuUtil: 60,
      memoryPercent: 75,
      mlPercent: 0,
    });

    close(db);
  });
});

describe("getGpuWeeklyOverview", () => {
  it("summarizes GPU and ML/DL use from Saturday through Friday", () => {
    const db = testDb();
    const sampledAt = new Date(2026, 5, 23, 10, 5);

    insertGpuSample(
      {
        gpuUtil: 30,
        memoryUsedMb: 2000,
        memoryTotalMb: 8000,
        sampledAt,
      },
      db,
    );
    insertGpuSample(
      {
        gpuUtil: 70,
        memoryUsedMb: 6000,
        memoryTotalMb: 8000,
        sampledAt: new Date(2026, 5, 23, 10, 20),
      },
      db,
    );
    insertGpuProcessSamples(
      [
        {
          pid: 1234,
          processName: "python.exe",
          commandLine: "python -m torch train.py",
          usedMemoryMb: 4096,
          sampledAt,
        },
      ],
      db,
    );

    const overview = getGpuWeeklyOverview(new Date(2026, 5, 23, 10, 30), db, 15);
    const today = overview[3];

    expect(overview).toHaveLength(7);
    expect(overview.map((point) => point.date)).toEqual([
      "2026-06-20",
      "2026-06-21",
      "2026-06-22",
      "2026-06-23",
      "2026-06-24",
      "2026-06-25",
      "2026-06-26",
    ]);
    expect(today).toMatchObject({
      date: "2026-06-23",
      gpuAverage: 50,
      gpuPeak: 70,
      memoryAverage: 50,
      sampleCount: 2,
      mlBucketCount: 1,
      bucketCount: 43,
    });
    expect(today?.mlPercent).toBe(2);

    close(db);
  });
});
