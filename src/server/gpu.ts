import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { appConfig } from "./config";
import type { LabScheduleManagerDatabase } from "./db";
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

export type GpuProcessInfo = {
  pid: number;
  processName: string;
  usedMemoryMb: number;
};

export type GpuProcessKind = {
  isPython: boolean;
  isLikelyMl: boolean;
  reason: "ml_keyword" | "python_gpu_memory" | "not_ml_process";
};

export type GpuProcessSample = GpuProcessInfo &
  GpuProcessKind & {
    commandLine: string | null;
    sampledAt: string;
    source: string;
  };

export type GpuMlActivitySummary = {
  windowMinutes: number;
  processCount: number;
  pythonProcessCount: number;
  likelyMlProcessCount: number;
  totalUsedMemoryMb: number;
  likelyMlUsedMemoryMb: number;
  isLikelyMlWorkload: boolean;
  processes: GpuProcessSample[];
};

export type GpuDaySeriesPoint = {
  bucketStart: string;
  gpuUtil: number | null;
  memoryPercent: number | null;
  mlPercent: number;
};

export type GpuWeeklyOverviewPoint = {
  date: string;
  gpuAverage: number | null;
  gpuPeak: number | null;
  memoryAverage: number | null;
  mlPercent: number;
  sampleCount: number;
  mlBucketCount: number;
  bucketCount: number;
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

type GpuProcessRow = {
  pid: number;
  process_name: string;
  command_line: string | null;
  used_memory_mb: number;
  is_python: number;
  is_likely_ml: number;
  detection_reason: GpuProcessKind["reason"];
  sampled_at: string;
  source: string;
};

type GpuDayProcessRow = {
  sampled_at: string;
  is_likely_ml: number;
};

type GpuWeeklyBucket = {
  date: string;
  start: Date;
  end: Date;
  gpuSum: number;
  gpuPeak: number | null;
  gpuCount: number;
  memorySum: number;
  memoryCount: number;
  mlBuckets: Set<number>;
  bucketCount: number;
};

type WindowsProcessInfo = {
  ProcessId?: number;
  Name?: string | null;
  CommandLine?: string | null;
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

export function parseNvidiaSmiComputeAppsOutput(
  output: string,
): GpuProcessInfo[] {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.toLowerCase().includes("no running processes"));

  return lines.map((line) => {
    const parts = line.split(",").map((part) => part.trim());
    if (parts.length < 3) {
      throw validationError(
        `Could not parse nvidia-smi compute process output: ${line}`,
      );
    }

    const pid = Number(parts[0]);
    const usedMemoryMb = Number(parts[parts.length - 1]);
    const processName = parts.slice(1, -1).join(",").trim();

    if (
      !Number.isInteger(pid) ||
      !processName ||
      !Number.isInteger(usedMemoryMb)
    ) {
      throw validationError(
        `Could not parse nvidia-smi compute process output: ${line}`,
      );
    }

    return { pid, processName, usedMemoryMb };
  });
}

function basename(value: string) {
  return value.split(/[\\/]/).pop()?.toLowerCase() ?? value.toLowerCase();
}

export function inferGpuProcessKind({
  processName,
  commandLine,
  usedMemoryMb,
}: GpuProcessInfo & { commandLine?: string | null }): GpuProcessKind {
  const processBase = basename(processName);
  const searchable = `${processName} ${commandLine ?? ""}`.toLowerCase();
  const isPython =
    processBase === "python.exe" ||
    processBase === "pythonw.exe" ||
    processBase === "python" ||
    processBase === "pythonw" ||
    searchable.includes("jupyter") ||
    searchable.includes("ipykernel");
  const hasMlKeyword = appConfig.mlProcessKeywords.some((keyword) =>
    searchable.includes(keyword.toLowerCase()),
  );

  if (hasMlKeyword) {
    return { isPython, isLikelyMl: true, reason: "ml_keyword" };
  }

  if (isPython && usedMemoryMb >= appConfig.mlProcessMinMemoryMb) {
    return { isPython, isLikelyMl: true, reason: "python_gpu_memory" };
  }

  return { isPython, isLikelyMl: false, reason: "not_ml_process" };
}

export async function readGpuViaNvidiaSmi(command = appConfig.nvidiaSmiPath) {
  const { stdout } = await execFileAsync(command, [
    "--query-gpu=utilization.gpu,memory.used,memory.total",
    "--format=csv,noheader,nounits",
  ]);

  return parseNvidiaSmiOutput(stdout);
}

export async function readGpuComputeAppsViaNvidiaSmi(
  command = appConfig.nvidiaSmiPath,
) {
  const { stdout } = await execFileAsync(command, [
    "--query-compute-apps=pid,process_name,used_gpu_memory",
    "--format=csv,noheader,nounits",
  ]);

  return parseNvidiaSmiComputeAppsOutput(stdout);
}

async function readWindowsProcessInfo(pids: number[]) {
  if (process.platform !== "win32" || pids.length === 0) {
    return new Map<number, { name: string | null; commandLine: string | null }>();
  }

  const uniquePids = [...new Set(pids)].filter(Number.isInteger);
  const filter = uniquePids.map((pid) => `ProcessId=${pid}`).join(" OR ");
  const command = `$items = Get-CimInstance Win32_Process -Filter '${filter}' | Select-Object ProcessId,Name,CommandLine; $items | ConvertTo-Json -Compress`;

  try {
    const { stdout } = await execFileAsync(
      "powershell",
      ["-NoProfile", "-Command", command],
      { timeout: 5000, windowsHide: true },
    );
    const parsed = JSON.parse(stdout || "[]") as
      | WindowsProcessInfo
      | WindowsProcessInfo[];
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    const map = new Map<
      number,
      { name: string | null; commandLine: string | null }
    >();

    for (const row of rows) {
      if (typeof row.ProcessId === "number") {
        map.set(row.ProcessId, {
          name: row.Name ?? null,
          commandLine: row.CommandLine ?? null,
        });
      }
    }

    return map;
  } catch {
    return new Map<number, { name: string | null; commandLine: string | null }>();
  }
}

export function insertGpuSample(
  sample: {
    gpuUtil: number;
    memoryUsedMb: number;
    memoryTotalMb?: number;
    sampledAt?: Date;
  },
  db: LabScheduleManagerDatabase = getDb(),
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

export function insertGpuProcessSamples(
  processes: Array<
    GpuProcessInfo & {
      commandLine?: string | null;
      sampledAt?: Date;
    }
  >,
  db: LabScheduleManagerDatabase = getDb(),
) {
  const sampledAt = (processes[0]?.sampledAt ?? new Date()).toISOString();
  const insert = db.prepare(`
    INSERT INTO gpu_process_samples (
      sampled_at,
      pid,
      process_name,
      command_line,
      used_memory_mb,
      is_python,
      is_likely_ml,
      detection_reason,
      source
    )
    VALUES (
      @sampledAt,
      @pid,
      @processName,
      @commandLine,
      @usedMemoryMb,
      @isPython,
      @isLikelyMl,
      @reason,
      'nvidia-smi'
    )
  `);

  const rows = processes.map((processInfo) => {
    const kind = inferGpuProcessKind(processInfo);
    return {
      ...processInfo,
      commandLine: processInfo.commandLine ?? null,
      sampledAt,
      source: "nvidia-smi",
      ...kind,
    } satisfies GpuProcessSample;
  });

  const tx = db.transaction(() => {
    for (const row of rows) {
      insert.run({
        sampledAt: row.sampledAt,
        pid: row.pid,
        processName: row.processName,
        commandLine: row.commandLine,
        usedMemoryMb: row.usedMemoryMb,
        isPython: row.isPython ? 1 : 0,
        isLikelyMl: row.isLikelyMl ? 1 : 0,
        reason: row.reason,
      });
    }
  });

  tx();
  return rows;
}

export async function sampleGpuProcessesNow(
  db: LabScheduleManagerDatabase = getDb(),
  now = new Date(),
) {
  const processes = await readGpuComputeAppsViaNvidiaSmi();
  const processInfo = await readWindowsProcessInfo(
    processes.map((processInfoItem) => processInfoItem.pid),
  );
  const enriched = processes.map((processInfoItem) => {
    const windowsInfo = processInfo.get(processInfoItem.pid);
    return {
      ...processInfoItem,
      processName: windowsInfo?.name ?? processInfoItem.processName,
      commandLine: windowsInfo?.commandLine ?? null,
      sampledAt: now,
    };
  });

  return insertGpuProcessSamples(enriched, db);
}

export function getLatestGpuSample(db: LabScheduleManagerDatabase = getDb()) {
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

function mapGpuProcessRow(row: GpuProcessRow): GpuProcessSample {
  return {
    pid: row.pid,
    processName: row.process_name,
    commandLine: row.command_line,
    usedMemoryMb: row.used_memory_mb,
    isPython: row.is_python === 1,
    isLikelyMl: row.is_likely_ml === 1,
    reason: row.detection_reason,
    sampledAt: row.sampled_at,
    source: row.source,
  };
}

export function getGpuMlActivitySummary(
  now = new Date(),
  windowMinutes = appConfig.gpuIdleWindowMinutes,
  db: LabScheduleManagerDatabase = getDb(),
): GpuMlActivitySummary {
  const since = new Date(now.getTime() - windowMinutes * 60_000).toISOString();
  const rows = db
    .prepare(
      `
      SELECT *
      FROM gpu_process_samples
      WHERE sampled_at >= ?
      ORDER BY datetime(sampled_at) ASC, id ASC
    `,
    )
    .all(since) as GpuProcessRow[];
  const latestByPid = new Map<number, GpuProcessSample>();

  for (const row of rows) {
    latestByPid.set(row.pid, mapGpuProcessRow(row));
  }

  const processes = [...latestByPid.values()].sort(
    (first, second) => second.usedMemoryMb - first.usedMemoryMb,
  );
  const likelyMlProcesses = processes.filter((processInfo) => processInfo.isLikelyMl);

  return {
    windowMinutes,
    processCount: processes.length,
    pythonProcessCount: processes.filter((processInfo) => processInfo.isPython)
      .length,
    likelyMlProcessCount: likelyMlProcesses.length,
    totalUsedMemoryMb: processes.reduce(
      (sum, processInfo) => sum + processInfo.usedMemoryMb,
      0,
    ),
    likelyMlUsedMemoryMb: likelyMlProcesses.reduce(
      (sum, processInfo) => sum + processInfo.usedMemoryMb,
      0,
    ),
    isLikelyMlWorkload: likelyMlProcesses.length > 0,
    processes: processes.slice(0, 6),
  };
}

export async function sampleGpuNow(db: LabScheduleManagerDatabase = getDb()) {
  const sample = await readGpuViaNvidiaSmi();
  return insertGpuSample(sample, db);
}

export function listRecentGpuSamples(
  limit = 24,
  db: LabScheduleManagerDatabase = getDb(),
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

export function getGpuDaySeries(
  now = new Date(),
  db: LabScheduleManagerDatabase = getDb(),
  bucketMinutes = 15,
): GpuDaySeriesPoint[] {
  const bucketMs = Math.max(1, bucketMinutes) * 60_000;
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);

  const bucketCount = Math.max(
    1,
    Math.floor((now.getTime() - dayStart.getTime()) / bucketMs) + 1,
  );
  const buckets = Array.from({ length: bucketCount }, (_, index) => ({
    bucketStart: new Date(dayStart.getTime() + index * bucketMs).toISOString(),
    gpuSum: 0,
    gpuCount: 0,
    memorySum: 0,
    memoryCount: 0,
    processCount: 0,
    likelyMlCount: 0,
  }));
  const bucketIndex = (sampledAt: string) =>
    Math.floor((new Date(sampledAt).getTime() - dayStart.getTime()) / bucketMs);
  const startIso = dayStart.toISOString();
  const endIso = now.toISOString();
  const gpuRows = db
    .prepare(
      `
      SELECT gpu_util, memory_used_mb, memory_total_mb, sampled_at, source
      FROM gpu_samples
      WHERE sampled_at >= ? AND sampled_at <= ?
      ORDER BY datetime(sampled_at) ASC, id ASC
    `,
    )
    .all(startIso, endIso) as GpuRow[];
  const processRows = db
    .prepare(
      `
      SELECT sampled_at, is_likely_ml
      FROM gpu_process_samples
      WHERE sampled_at >= ? AND sampled_at <= ?
      ORDER BY datetime(sampled_at) ASC, id ASC
    `,
    )
    .all(startIso, endIso) as GpuDayProcessRow[];

  for (const row of gpuRows) {
    const index = bucketIndex(row.sampled_at);
    const bucket = buckets[index];
    if (!bucket) {
      continue;
    }

    bucket.gpuSum += row.gpu_util;
    bucket.gpuCount += 1;

    if (row.memory_total_mb > 0) {
      bucket.memorySum += (row.memory_used_mb / row.memory_total_mb) * 100;
      bucket.memoryCount += 1;
    }
  }

  for (const row of processRows) {
    const index = bucketIndex(row.sampled_at);
    const bucket = buckets[index];
    if (!bucket) {
      continue;
    }

    bucket.processCount += 1;
    if (row.is_likely_ml === 1) {
      bucket.likelyMlCount += 1;
    }
  }

  return buckets.map((bucket) => ({
    bucketStart: bucket.bucketStart,
    gpuUtil:
      bucket.gpuCount === 0
        ? null
        : Math.round((bucket.gpuSum / bucket.gpuCount) * 10) / 10,
    memoryPercent:
      bucket.memoryCount === 0
        ? null
        : Math.round((bucket.memorySum / bucket.memoryCount) * 10) / 10,
    mlPercent:
      bucket.processCount === 0
        ? 0
        : Math.round((bucket.likelyMlCount / bucket.processCount) * 100),
  }));
}

function dateKey(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getGpuWeeklyOverview(
  now = new Date(),
  db: LabScheduleManagerDatabase = getDb(),
  bucketMinutes = 15,
): GpuWeeklyOverviewPoint[] {
  const bucketMs = Math.max(1, bucketMinutes) * 60_000;
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const weekStart = new Date(todayStart);
  weekStart.setDate(todayStart.getDate() - ((todayStart.getDay() + 1) % 7));
  const buckets: GpuWeeklyBucket[] = Array.from({ length: 7 }, (_, index) => {
    const start = new Date(weekStart);
    start.setDate(weekStart.getDate() + index);
    const end = new Date(start);
    end.setDate(start.getDate() + 1);
    const cappedEnd = end.getTime() > now.getTime() ? now : end;
    const isToday = end.getTime() > now.getTime();
    const durationMs = Math.max(0, cappedEnd.getTime() - start.getTime());

    return {
      date: dateKey(start),
      start,
      end: cappedEnd,
      gpuSum: 0,
      gpuPeak: null,
      gpuCount: 0,
      memorySum: 0,
      memoryCount: 0,
      mlBuckets: new Set<number>(),
      bucketCount: Math.max(
        1,
        isToday
          ? Math.floor(durationMs / bucketMs) + 1
          : Math.ceil(durationMs / bucketMs),
      ),
    };
  });
  const firstStart = buckets[0].start.toISOString();
  const finalEnd = now.toISOString();
  const gpuRows = db
    .prepare(
      `
      SELECT gpu_util, memory_used_mb, memory_total_mb, sampled_at, source
      FROM gpu_samples
      WHERE sampled_at >= ? AND sampled_at <= ?
      ORDER BY datetime(sampled_at) ASC, id ASC
    `,
    )
    .all(firstStart, finalEnd) as GpuRow[];
  const processRows = db
    .prepare(
      `
      SELECT sampled_at, is_likely_ml
      FROM gpu_process_samples
      WHERE sampled_at >= ? AND sampled_at <= ? AND is_likely_ml = 1
      ORDER BY datetime(sampled_at) ASC, id ASC
    `,
    )
    .all(firstStart, finalEnd) as GpuDayProcessRow[];

  const findBucket = (sampledAt: string) => {
    const time = new Date(sampledAt).getTime();
    return buckets.find(
      (bucket) =>
        time >= bucket.start.getTime() && time <= bucket.end.getTime(),
    );
  };

  for (const row of gpuRows) {
    const bucket = findBucket(row.sampled_at);
    if (!bucket) {
      continue;
    }

    bucket.gpuSum += row.gpu_util;
    bucket.gpuCount += 1;
    bucket.gpuPeak =
      bucket.gpuPeak === null ? row.gpu_util : Math.max(bucket.gpuPeak, row.gpu_util);

    if (row.memory_total_mb > 0) {
      bucket.memorySum += (row.memory_used_mb / row.memory_total_mb) * 100;
      bucket.memoryCount += 1;
    }
  }

  for (const row of processRows) {
    const bucket = findBucket(row.sampled_at);
    if (!bucket) {
      continue;
    }

    bucket.mlBuckets.add(
      Math.floor((new Date(row.sampled_at).getTime() - bucket.start.getTime()) / bucketMs),
    );
  }

  return buckets.map((bucket) => ({
    date: bucket.date,
    gpuAverage:
      bucket.gpuCount === 0
        ? null
        : Math.round((bucket.gpuSum / bucket.gpuCount) * 10) / 10,
    gpuPeak: bucket.gpuPeak,
    memoryAverage:
      bucket.memoryCount === 0
        ? null
        : Math.round((bucket.memorySum / bucket.memoryCount) * 10) / 10,
    mlPercent: Math.round((bucket.mlBuckets.size / bucket.bucketCount) * 100),
    sampleCount: bucket.gpuCount,
    mlBucketCount: bucket.mlBuckets.size,
    bucketCount: bucket.bucketCount,
  }));
}

export function getGpuAverage(
  now = new Date(),
  windowMinutes = appConfig.gpuIdleWindowMinutes,
  db: LabScheduleManagerDatabase = getDb(),
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
  db: LabScheduleManagerDatabase = getDb(),
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
