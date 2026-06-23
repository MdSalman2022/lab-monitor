import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { appConfig } from "./config";
import type { LabBeaconDatabase } from "./db";
import { getDb } from "./db";
import { validationError } from "./errors";

const execFileAsync = promisify(execFile);

export type GpuSample = {
  gpuUtil: number;
  memoryUsedMb: number;
  memoryTotalMb: number;
  sampledAt: string;
  source: string;
};

export type GpuActivitySummary = {
  averageUtil: number | null;
  sampleCount: number;
  windowMinutes: number;
  threshold: number;
  activeSampleCount: number;
  activeSampleRatio: number;
  consecutiveActiveSamples: number;
  peakUtil: number | null;
  isSustained: boolean;
  hasBurstOnly: boolean;
};

type GpuRow = {
  gpu_util: number;
  memory_used_mb: number;
  memory_total_mb: number;
  sampled_at: string;
  source: string;
};

export function parseNvidiaSmiOutput(output: string) {
  const firstLine = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  if (!firstLine) {
    throw validationError("nvidia-smi returned no GPU data");
  }

  const [utilRaw, memoryRaw, memoryTotalRaw] = firstLine
    .split(",")
    .map((part) => part.trim());
  const gpuUtil = Number(utilRaw);
  const memoryUsedMb = Number(memoryRaw);
  const memoryTotalMb =
    memoryTotalRaw === undefined || memoryTotalRaw === ""
      ? 0
      : Number(memoryTotalRaw);

  if (
    !Number.isInteger(gpuUtil) ||
    !Number.isInteger(memoryUsedMb) ||
    !Number.isInteger(memoryTotalMb)
  ) {
    throw validationError(`Could not parse nvidia-smi output: ${firstLine}`);
  }

  return { gpuUtil, memoryUsedMb, memoryTotalMb };
}

export async function readGpuViaNvidiaSmi(command = appConfig.nvidiaSmiPath) {
  const { stdout } = await execFileAsync(command, [
    "--query-gpu=utilization.gpu,memory.used,memory.total",
    "--format=csv,noheader,nounits",
  ]);

  return parseNvidiaSmiOutput(stdout);
}

export function insertGpuSample(
  sample: {
    gpuUtil: number;
    memoryUsedMb: number;
    memoryTotalMb?: number;
    sampledAt?: Date;
  },
  db: LabBeaconDatabase = getDb(),
) {
  const sampledAt = (sample.sampledAt ?? new Date()).toISOString();

  db.prepare(`
    INSERT INTO gpu_samples (sampled_at, gpu_util, memory_used_mb, memory_total_mb, source)
    VALUES (@sampledAt, @gpuUtil, @memoryUsedMb, @memoryTotalMb, 'nvidia-smi')
  `).run({
    sampledAt,
    gpuUtil: sample.gpuUtil,
    memoryUsedMb: sample.memoryUsedMb,
    memoryTotalMb: sample.memoryTotalMb ?? 0,
  });

  return {
    gpuUtil: sample.gpuUtil,
    memoryUsedMb: sample.memoryUsedMb,
    memoryTotalMb: sample.memoryTotalMb ?? 0,
    sampledAt,
    source: "nvidia-smi",
  } satisfies GpuSample;
}

export function getLatestGpuSample(db: LabBeaconDatabase = getDb()) {
  const row = db
    .prepare(
      "SELECT * FROM gpu_samples ORDER BY datetime(sampled_at) DESC, id DESC LIMIT 1",
    )
    .get() as GpuRow | undefined;

  if (!row) {
    return null;
  }

  return {
    gpuUtil: row.gpu_util,
    memoryUsedMb: row.memory_used_mb,
    memoryTotalMb: row.memory_total_mb,
    sampledAt: row.sampled_at,
    source: row.source,
  } satisfies GpuSample;
}

export async function sampleGpuNow(db: LabBeaconDatabase = getDb()) {
  const sample = await readGpuViaNvidiaSmi();
  return insertGpuSample(sample, db);
}

export function listRecentGpuSamples(
  limit = 24,
  db: LabBeaconDatabase = getDb(),
) {
  const rows = db
    .prepare(
      `
      SELECT *
      FROM gpu_samples
      ORDER BY datetime(sampled_at) DESC, id DESC
      LIMIT ?
    `,
    )
    .all(limit) as GpuRow[];

  return rows.reverse().map((row) => ({
    gpuUtil: row.gpu_util,
    memoryUsedMb: row.memory_used_mb,
    memoryTotalMb: row.memory_total_mb,
    sampledAt: row.sampled_at,
    source: row.source,
  }));
}

export function getGpuAverage(
  now = new Date(),
  windowMinutes = appConfig.gpuIdleWindowMinutes,
  db: LabBeaconDatabase = getDb(),
) {
  const since = new Date(now.getTime() - windowMinutes * 60_000).toISOString();
  const row = db
    .prepare(
      "SELECT AVG(gpu_util) as averageUtil, COUNT(*) as sampleCount FROM gpu_samples WHERE sampled_at >= ?",
    )
    .get(since) as { averageUtil: number | null; sampleCount: number };

  return {
    averageUtil:
      row.averageUtil === null ? null : Math.round(row.averageUtil * 10) / 10,
    sampleCount: row.sampleCount,
    windowMinutes,
  };
}

export function getGpuActivitySummary(
  now = new Date(),
  {
    windowMinutes = appConfig.gpuIdleWindowMinutes,
    threshold = appConfig.gpuIdleThreshold,
    minActiveRatio = appConfig.gpuBusyMinActiveRatio,
    minConsecutiveSamples = appConfig.gpuBusyMinConsecutiveSamples,
  }: {
    windowMinutes?: number;
    threshold?: number;
    minActiveRatio?: number;
    minConsecutiveSamples?: number;
  } = {},
  db: LabBeaconDatabase = getDb(),
): GpuActivitySummary {
  const recent = listRecentGpuSamples(
    Math.max(minConsecutiveSamples + 2, windowMinutes * 2),
    db,
  ).filter((sample) => {
    const sampledAt = new Date(sample.sampledAt).getTime();
    return sampledAt >= now.getTime() - windowMinutes * 60_000;
  });

  const sampleCount = recent.length;
  const averageUtil =
    sampleCount === 0
      ? null
      : Math.round(
          (recent.reduce((sum, sample) => sum + sample.gpuUtil, 0) / sampleCount) *
            10,
        ) / 10;
  const activeSampleCount = recent.filter(
    (sample) => sample.gpuUtil >= threshold,
  ).length;
  const activeSampleRatio =
    sampleCount === 0 ? 0 : activeSampleCount / sampleCount;
  const peakUtil =
    sampleCount === 0
      ? null
      : recent.reduce((peak, sample) => Math.max(peak, sample.gpuUtil), 0);

  let consecutiveActiveSamples = 0;
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    if (recent[index].gpuUtil >= threshold) {
      consecutiveActiveSamples += 1;
      continue;
    }
    break;
  }

  const isSustained =
    sampleCount >= minConsecutiveSamples &&
    activeSampleRatio >= minActiveRatio &&
    consecutiveActiveSamples >= minConsecutiveSamples;

  return {
    averageUtil,
    sampleCount,
    windowMinutes,
    threshold,
    activeSampleCount,
    activeSampleRatio:
      sampleCount === 0 ? 0 : Math.round(activeSampleRatio * 100) / 100,
    consecutiveActiveSamples,
    peakUtil,
    isSustained,
    hasBurstOnly:
      activeSampleCount > 0 &&
      !isSustained &&
      (peakUtil ?? 0) >= threshold,
  };
}
