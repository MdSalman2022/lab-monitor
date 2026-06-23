"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { CSSProperties } from "react";
import {
  Activity,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Clock3,
  Database,
  LogOut,
  PencilLine,
  Radio,
  RefreshCw,
  Signal,
  Trash2,
  UserPlus,
  WifiOff,
  X,
  Zap,
} from "lucide-react";

type UserRecord = {
  id: number;
  name: string;
  isActive: boolean;
};

type SessionRecord = {
  id: number;
  userId: number;
  userName: string;
  status: "ACTIVE" | "NEEDS_CONFIRMATION" | "INACTIVE" | "ENDED";
  startedAt: string;
  lastCheckinAt: string;
  endedAt: string | null;
  endReason: string | null;
  nextCheckinDueAt: string;
  overdueAt: string;
};

type ScheduleSlot = {
  id: number;
  userId: number;
  userName: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  isActive: boolean;
};

type EventRecord = {
  id: number;
  type: string;
  message: string;
  createdAt: string;
};

type GpuSample = {
  gpuUtil: number;
  memoryUsedMb: number;
  memoryTotalMb: number;
  sampledAt: string;
  source: string;
};

type GpuProcessSample = {
  pid: number;
  processName: string;
  commandLine: string | null;
  usedMemoryMb: number;
  isPython: boolean;
  isLikelyMl: boolean;
  reason: "ml_keyword" | "python_gpu_memory" | "not_ml_process";
  sampledAt: string;
  source: string;
};

type GpuDayPoint = {
  bucketStart: string;
  gpuUtil: number | null;
  memoryPercent: number | null;
  mlPercent: number;
};

type GpuWeeklyPoint = {
  date: string;
  gpuAverage: number | null;
  gpuPeak: number | null;
  memoryAverage: number | null;
  mlPercent: number;
  sampleCount: number;
  mlBucketCount: number;
  bucketCount: number;
};

type StatusResponse = {
  now: string;
  config: {
    checkinIntervalMinutes: number;
    graceMinutes: number;
    confirmationWarningMinutes: number;
    confirmationDangerMinutes: number;
    gpuIdleThreshold: number;
    gpuIdleWindowMinutes: number;
    gpuBusyMinActiveRatio: number;
    gpuBusyMinConsecutiveSamples: number;
    pollSeconds: number;
  };
  users: UserRecord[];
  openSession: SessionRecord | null;
  gpu: {
    latest: GpuSample | null;
    recent: GpuSample[];
    day: GpuDayPoint[];
    weekly: GpuWeeklyPoint[];
    average: {
      averageUtil: number | null;
      sampleCount: number;
      windowMinutes: number;
    };
    activity: {
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
    processActivity: {
      windowMinutes: number;
      processCount: number;
      pythonProcessCount: number;
      likelyMlProcessCount: number;
      totalUsedMemoryMb: number;
      likelyMlUsedMemoryMb: number;
      isLikelyMlWorkload: boolean;
      processes: GpuProcessSample[];
    };
    isIdle: boolean | null;
  };
  schedule: {
    current: ScheduleSlot | null;
    slots: ScheduleSlot[];
  };
  today: {
    date: string;
    sessions: SessionRecord[];
  };
  events: EventRecord[];
};

type Panel = "operate" | "log";
type ConfirmationTone = "normal" | "warning" | "danger";

const DAY_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const DAY_OPTIONS = [
  { value: 6, label: "Saturday" },
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
];
const REFRESH_MS = 3000;

function classNames(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function pctStyle(value: number) {
  return { "--value": `${clamp(value)}%` } as CSSProperties;
}

function formatTime(value: string | null) {
  if (!value) {
    return "Not set";
  }

  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Dhaka",
  }).format(new Date(value));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Dhaka",
  }).format(new Date(value));
}

function formatWeekday(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone: "Asia/Dhaka",
  }).format(new Date(`${value}T00:00:00`));
}

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "Asia/Dhaka",
  }).format(new Date(`${value}T00:00:00`));
}

function formatDuration(ms: number) {
  const absolute = Math.abs(ms);
  const totalMinutes = Math.max(0, Math.floor(absolute / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) {
    return `${minutes}m`;
  }

  return `${hours}h ${minutes}m`;
}

function formatAge(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) {
    return `${seconds}s ago`;
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  return `${Math.floor(minutes / 60)}h ago`;
}

function formatMemory(mb: number) {
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(1)} GB`;
  }

  return `${mb.toLocaleString()} MB`;
}

function getConfirmationTone(
  derived: {
    dueInMs: number;
    isOverdue: boolean;
  } | null,
  warningMinutes: number,
  dangerMinutes: number,
): ConfirmationTone {
  if (!derived) {
    return "normal";
  }

  if (
    derived.isOverdue ||
    derived.dueInMs < Math.max(0, dangerMinutes) * 60_000
  ) {
    return "danger";
  }

  if (derived.dueInMs < Math.max(0, warningMinutes) * 60_000) {
    return "warning";
  }

  return "normal";
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers ?? {}),
    },
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error?.message ?? "Request failed");
  }

  return data as T;
}

export function Dashboard() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [activePanel, setActivePanel] = useState<Panel>("operate");
  const [scheduleSelection, setScheduleSelection] = useState<{
    dayOfWeek: number;
    slotId: number | null;
  } | null>(null);
  const [selectedClaimUserId, setSelectedClaimUserId] = useState("");
  const [editingUserId, setEditingUserId] = useState<number | null>(null);
  const [userForm, setUserForm] = useState({ name: "" });
  const [newUserName, setNewUserName] = useState("");
  const [isAddingUser, setIsAddingUser] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [clientNow, setClientNow] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    try {
      const nextStatus = await requestJson<StatusResponse>("/api/status", {
        cache: "no-store",
      });
      setSelectedClaimUserId((current) => {
        if (
          current &&
          nextStatus.users.some((user) => String(user.id) === current)
        ) {
          return current;
        }

        return String(
          nextStatus.schedule.current?.userId ?? nextStatus.users[0]?.id ?? "",
        );
      });
      setStatus(nextStatus);
      setError(null);
      setLastUpdatedAt(Date.now());
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not load Lab Schedule Manager status",
      );
    }
  }, []);

  useEffect(() => {
    const tick = window.setInterval(() => {
      setClientNow(Date.now());
    }, 1000);

    return () => window.clearInterval(tick);
  }, []);

  useEffect(() => {
    const firstLoad = window.setTimeout(() => {
      void refresh();
    }, 0);
    const interval = window.setInterval(() => {
      void refresh();
    }, REFRESH_MS);

    return () => {
      window.clearTimeout(firstLoad);
      window.clearInterval(interval);
    };
  }, [refresh]);

  async function runAction(name: string, action: () => Promise<unknown>) {
    setBusyAction(name);
    try {
      await action();
      await refresh();
    } catch (actionError) {
      setError(
        actionError instanceof Error ? actionError.message : "Action failed",
      );
    } finally {
      setBusyAction(null);
    }
  }

  const derived = useMemo(() => {
    if (!status?.openSession) {
      return null;
    }

    const dueMs = new Date(status.openSession.nextCheckinDueAt).getTime();
    const overdueMs = new Date(status.openSession.overdueAt).getTime();

    return {
      dueInMs: dueMs - clientNow,
      overdueInMs: overdueMs - clientNow,
      isOverdue: clientNow > overdueMs,
    };
  }, [clientNow, status]);

  if (!status) {
    return <LoadingState />;
  }

  const openSession = status.openSession;
  const latestGpu = status.gpu.latest;
  const gpuUtil = latestGpu?.gpuUtil ?? 0;
  const memoryUsed = latestGpu?.memoryUsedMb ?? 0;
  const memoryTotal = latestGpu?.memoryTotalMb ?? 0;
  const memoryPercent = memoryTotal > 0 ? (memoryUsed / memoryTotal) * 100 : 0;
  const sampleAgeMs = latestGpu
    ? Math.max(0, clientNow - new Date(latestGpu.sampledAt).getTime())
    : null;
  const lastUpdateAge = lastUpdatedAt
    ? Math.max(0, clientNow - lastUpdatedAt)
    : null;
  const isBusy = busyAction !== null;
  const isGpuBusy = status.gpu.activity.isSustained;
  const hasBurstOnly = status.gpu.activity.hasBurstOnly;
  const handleCheckIn = () => {
    if (!openSession) {
      return;
    }
    void runAction("checkin", () =>
      requestJson("/api/sessions/checkin", {
        method: "POST",
        body: JSON.stringify({ sessionId: openSession.id }),
      }),
    );
  };
  const handleEnd = () => {
    if (!openSession) {
      return;
    }
    void runAction("end", () =>
      requestJson("/api/sessions/end", {
        method: "POST",
        body: JSON.stringify({ sessionId: openSession.id }),
      }),
    );
  };
  const handleClaim = () => {
    if (!selectedClaimUserId) {
      return;
    }

    void runAction(`claim-${selectedClaimUserId}`, () =>
      requestJson("/api/sessions/claim", {
        method: "POST",
        body: JSON.stringify({ userId: Number(selectedClaimUserId) }),
      }),
    );
  };
  const chooseScheduleDay = (dayOfWeek: number) => {
    setScheduleSelection({ dayOfWeek, slotId: null });
  };
  const editScheduleSlot = (slot: ScheduleSlot) => {
    setScheduleSelection({ dayOfWeek: slot.dayOfWeek, slotId: slot.id });
  };
  const assignScheduleDay = (userId: number) => {
    if (!scheduleSelection) {
      return;
    }

    void runAction("schedule", async () => {
      await requestJson("/api/schedule", {
        method: scheduleSelection.slotId === null ? "POST" : "PATCH",
        body: JSON.stringify({
          ...(scheduleSelection.slotId === null
            ? {}
            : { id: scheduleSelection.slotId }),
          userId,
          dayOfWeek: scheduleSelection.dayOfWeek,
          startTime: "00:00",
          endTime: "00:00",
        }),
      });
      setScheduleSelection(null);
    });
  };
  const editUser = (user: UserRecord) => {
    setEditingUserId(user.id);
    setUserForm({
      name: user.name,
    });
  };
  const submitUser = () => {
    if (editingUserId === null) {
      return;
    }

    void runAction(`user-${editingUserId}`, async () => {
      await requestJson("/api/users", {
        method: "PATCH",
        body: JSON.stringify({
          id: editingUserId,
          name: userForm.name,
        }),
      });
      setEditingUserId(null);
    });
  };
  const submitNewUser = () => {
    const trimmed = newUserName.trim();
    if (!trimmed) {
      return;
    }

    void runAction("user-create", async () => {
      await requestJson("/api/users", {
        method: "POST",
        body: JSON.stringify({ name: trimmed }),
      });
      setNewUserName("");
      setIsAddingUser(false);
    });
  };

  return (
    <main className="lb-shell">
      <section className="lb-topbar">
        <div>
          <p className="lb-kicker">Lab Schedule Manager</p>
          <h1 className="lb-title">Lab Available status</h1>
          <p className="lb-subtitle">
            Live GPU load, sustained activity, check-ins, and shift handoff for
            one shared machine.
          </p>
        </div>

        <div className="lb-live-cluster" aria-label="Live dashboard state">
          <LiveBadge isLive={!error} />
          <StatusPill
            tone={openSession ? "success" : "neutral"}
            label={openSession ? "Occupied" : "Available"}
          />
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={isBusy}
            className="lb-icon-button"
            aria-label="Refresh status"
            title="Refresh status"
          >
            <RefreshCw
              className={classNames("h-4 w-4", isBusy && "animate-spin")}
              aria-hidden="true"
            />
          </button>
        </div>
      </section>

      {error ? (
        <div className="lb-alert" role="status">
          <WifiOff className="h-4 w-4" aria-hidden="true" />
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)}>
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      ) : null}

      <section className="lb-command-grid" aria-label="Shift and schedule">
        <SchedulePanel
          slots={status.schedule.slots}
          users={status.users}
          current={status.schedule.current}
          selection={scheduleSelection}
          busyAction={busyAction}
          onChooseDay={chooseScheduleDay}
          onCancelEdit={() => {
            setScheduleSelection(null);
          }}
          onAssign={assignScheduleDay}
          onEdit={editScheduleSlot}
          onDelete={(id) =>
            void runAction(`delete-slot-${id}`, () =>
              requestJson("/api/schedule", {
                method: "DELETE",
                body: JSON.stringify({ id }),
              }),
            )
          }
        />

        <SessionHero
          session={openSession}
          derived={derived}
          currentSlot={status.schedule.current}
          checkinIntervalMinutes={status.config.checkinIntervalMinutes}
          confirmationWarningMinutes={status.config.confirmationWarningMinutes}
          confirmationDangerMinutes={status.config.confirmationDangerMinutes}
          users={status.users}
          selectedClaimUserId={selectedClaimUserId}
          busyAction={busyAction}
          isMlRunning={status.gpu.processActivity.isLikelyMlWorkload}
          onClaim={handleClaim}
          onSelectedClaimUserIdChange={setSelectedClaimUserId}
          onCheckIn={handleCheckIn}
          onEnd={handleEnd}
        />
      </section>

      <section className="lb-telemetry-grid" aria-label="Live telemetry and users">
        <TelemetryHero
          gpuUtil={gpuUtil}
          memoryPercent={memoryPercent}
          memoryUsed={memoryUsed}
          memoryTotal={memoryTotal}
          averageUtil={status.gpu.average.averageUtil}
          sampleAgeMs={sampleAgeMs}
          isGpuBusy={isGpuBusy}
          hasBurstOnly={hasBurstOnly}
          activity={status.gpu.activity}
          processActivity={status.gpu.processActivity}
          day={status.gpu.day}
        />

        <OperatorPanel
          users={status.users}
          openSession={openSession}
          busyAction={busyAction}
          editingUserId={editingUserId}
          userForm={userForm}
          setUserForm={setUserForm}
          onEditUser={editUser}
          onCancelEditUser={() => setEditingUserId(null)}
          onSubmitUser={submitUser}
          isAddingUser={isAddingUser}
          newUserName={newUserName}
          onNewUserNameChange={setNewUserName}
          onStartAddUser={() => setIsAddingUser(true)}
          onCancelAddUser={() => {
            setIsAddingUser(false);
            setNewUserName("");
          }}
          onSubmitNewUser={submitNewUser}
        />
      </section>

      <section className="lb-mobile-tabs" aria-label="Dashboard panels">
        <PanelButton
          active={activePanel === "operate"}
          label="Operate"
          onClick={() => setActivePanel("operate")}
        />
        <PanelButton
          active={activePanel === "log"}
          label="Log"
          onClick={() => setActivePanel("log")}
        />
      </section>

      <section className="lb-content-grid">
        <div
          className={classNames(
            "lb-panel-stack",
            activePanel !== "operate" && "lb-mobile-hidden",
          )}
        >
          <TodayPanel sessions={status.today.sessions} />
        </div>

        <div
          className={classNames(
            "lb-panel-stack",
            activePanel !== "log" && "lb-mobile-hidden",
          )}
        >
          <EventsPanel events={status.events} />
        </div>

        <div
          className={classNames(
            "lb-panel-stack",
            activePanel !== "log" && "lb-mobile-hidden",
          )}
        >
          <SystemPanel
            pollSeconds={status.config.pollSeconds}
            threshold={status.config.gpuIdleThreshold}
            windowMinutes={status.config.gpuIdleWindowMinutes}
            activeRatio={status.config.gpuBusyMinActiveRatio}
            consecutiveSamples={status.config.gpuBusyMinConsecutiveSamples}
            activity={status.gpu.activity}
            processActivity={status.gpu.processActivity}
            lastUpdateAge={lastUpdateAge}
            sampleAgeMs={sampleAgeMs}
          />
        </div>
      </section>

      <WeeklyOverviewPanel weekly={status.gpu.weekly} />

      {scheduleSelection ? createPortal(
        <SchedulePickerModal
          users={status.users}
          busyAction={busyAction}
          isChanging={scheduleSelection.slotId !== null}
          onAssign={assignScheduleDay}
          onCancel={() => setScheduleSelection(null)}
          onSubmitNewUser={async (name) => {
            const result = await requestJson<{ user: UserRecord }>(
              "/api/users",
              {
                method: "POST",
                body: JSON.stringify({ name }),
              },
            );
            assignScheduleDay(result.user.id);
          }}
        />,
        document.body,
      ) : null}
    </main>
  );
}

function LoadingState() {
  return (
    <main className="lb-shell">
      <div className="lb-loading-card" aria-busy="true">
        <div className="lb-loading-mark">
          <Radio className="h-5 w-5 animate-pulse" aria-hidden="true" />
        </div>
        <div>
          <p className="lb-kicker">Lab Schedule Manager</p>
          <h1 className="lb-loading-title">Waking the dashboard</h1>
          <p className="lb-muted">Preparing the live GPU control surface.</p>
        </div>
      </div>
    </main>
  );
}

function TelemetryHero({
  gpuUtil,
  memoryPercent,
  memoryUsed,
  memoryTotal,
  averageUtil,
  sampleAgeMs,
  isGpuBusy,
  hasBurstOnly,
  activity,
  processActivity,
  day,
}: {
  gpuUtil: number;
  memoryPercent: number;
  memoryUsed: number;
  memoryTotal: number;
  averageUtil: number | null;
  sampleAgeMs: number | null;
  isGpuBusy: boolean;
  hasBurstOnly: boolean;
  activity: StatusResponse["gpu"]["activity"];
  processActivity: StatusResponse["gpu"]["processActivity"];
  day: GpuDayPoint[];
}) {
  return (
    <article className="lb-hero-card lb-telemetry-card">
      <div className="lb-card-head">
        <div>
          <p className="lb-kicker">Live hardware</p>
          <h2 className="lb-card-title">GPU and VRAM</h2>
        </div>
        <StatusPill
          tone={
            processActivity.isLikelyMlWorkload || isGpuBusy
              ? "success"
              : hasBurstOnly
                ? "warning"
                : "neutral"
          }
          label={
            processActivity.isLikelyMlWorkload
              ? "ML/DL job detected"
              : isGpuBusy
              ? "Sustained activity"
              : hasBurstOnly
                ? "Short spike only"
                : "Idle pattern"
          }
        />
      </div>

      <div className="lb-telemetry-stats">
        <InfoItem label="GPU now" value={`${Math.round(clamp(gpuUtil))}%`} />
        <InfoItem
          label="10m GPU avg"
          value={averageUtil === null ? "Waiting" : `${averageUtil}%`}
        />
        <InfoItem
          label="VRAM now"
          value={`${Math.round(clamp(memoryPercent))}%`}
        />
        <InfoItem
          label="VRAM used"
          value={`${formatMemory(memoryUsed)} / ${memoryTotal ? formatMemory(memoryTotal) : "unknown"}`}
        />
        <InfoItem
          label="ML/DL signal"
          value={
            processActivity.isLikelyMlWorkload
              ? `${processActivity.likelyMlProcessCount} process`
              : "None"
          }
        />
      </div>

      <div className="lb-telemetry-footer">
        <div className="lb-history-grid">
          <DayUsageChart
            label="ML/DL"
            tone="ml"
            points={day}
            getValue={(point) => point.mlPercent}
            note="Likely ML/DL process share"
          />
          <DayUsageChart
            label="GPU"
            tone="gpu"
            points={day}
            getValue={(point) => point.gpuUtil}
            note={`${activity.threshold}% idle threshold`}
            threshold={activity.threshold}
          />
          <DayUsageChart
            label="VRAM"
            tone="memory"
            points={day}
            getValue={(point) => point.memoryPercent}
            note="Memory pressure"
          />
        </div>
        <p className="lb-fineprint">
          {sampleAgeMs === null
            ? "No GPU sample yet"
            : `Sampled ${formatAge(sampleAgeMs)} • ${Math.round(activity.activeSampleRatio * 100)}% of recent samples above ${activity.threshold}%`}
        </p>
      </div>
    </article>
  );
}

function DayUsageChart({
  label,
  tone,
  points,
  getValue,
  note,
  threshold,
}: {
  label: string;
  tone: "gpu" | "memory" | "ml";
  points: GpuDayPoint[];
  getValue: (point: GpuDayPoint) => number | null;
  note: string;
  threshold?: number;
}) {
  const latestIndex = useMemo(() => {
    for (let index = points.length - 1; index >= 0; index -= 1) {
      if (getValue(points[index]) !== null) {
        return index;
      }
    }

    return points.length > 0 ? points.length - 1 : null;
  }, [getValue, points]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const activeIndex =
    hoverIndex !== null && points[hoverIndex]
      ? hoverIndex
      : selectedIndex !== null && points[selectedIndex]
        ? selectedIndex
        : latestIndex;
  const activePoint = activeIndex === null ? null : points[activeIndex];
  const activeValue = activePoint ? getValue(activePoint) : null;
  const roundedActiveValue =
    activeValue === null ? null : Math.round(clamp(activeValue));

  return (
    <div className={classNames("lb-usage-chart", `is-${tone}`)}>
      <div className="lb-usage-chart-head">
        <div>
          <span>{label}</span>
          <small>
            {activePoint ? formatTime(activePoint.bucketStart) : "Today"}
          </small>
        </div>
        <strong>
          {roundedActiveValue === null ? "No data" : `${roundedActiveValue}%`}
        </strong>
      </div>
      <div
        className="lb-sample-strip"
        aria-label={`Today ${label} usage samples`}
        onPointerLeave={() => setHoverIndex(null)}
      >
        {threshold !== undefined ? (
          <span
            className="lb-threshold-line"
            style={pctStyle(threshold)}
            aria-hidden="true"
          />
        ) : null}
        {points.length === 0 ? (
          <span className="lb-muted">Waiting for samples</span>
        ) : (
          points.map((point, index) => {
            const rawValue = getValue(point);
            const value = rawValue === null ? 0 : Math.round(clamp(rawValue));

            return (
              <button
                key={`${label}-${point.bucketStart}`}
                type="button"
                className={classNames(
                  "lb-sample-bar",
                  activeIndex === index && "is-selected",
                  rawValue === null && "is-empty",
                )}
                style={pctStyle(value)}
                onClick={() => setSelectedIndex(index)}
                onPointerEnter={() => setHoverIndex(index)}
                onFocus={() => setHoverIndex(index)}
                onBlur={() => setHoverIndex(null)}
                aria-label={
                  rawValue === null
                    ? `${label} no data at ${formatTime(point.bucketStart)}`
                    : `${label} ${value}% at ${formatTime(point.bucketStart)}`
                }
                title={
                  rawValue === null
                    ? `${label} no data at ${formatTime(point.bucketStart)}`
                    : `${label} ${value}% at ${formatTime(point.bucketStart)}`
                }
              />
            );
          })
        )}
      </div>
      <p className="lb-chart-note">{note}</p>
    </div>
  );
}

function SessionHero({
  session,
  derived,
  currentSlot,
  checkinIntervalMinutes,
  confirmationWarningMinutes,
  confirmationDangerMinutes,
  users,
  selectedClaimUserId,
  busyAction,
  isMlRunning,
  onClaim,
  onSelectedClaimUserIdChange,
  onCheckIn,
  onEnd,
}: {
  session: SessionRecord | null;
  derived: {
    dueInMs: number;
    overdueInMs: number;
    isOverdue: boolean;
  } | null;
  currentSlot: ScheduleSlot | null;
  checkinIntervalMinutes: number;
  confirmationWarningMinutes: number;
  confirmationDangerMinutes: number;
  users: UserRecord[];
  selectedClaimUserId: string;
  busyAction: string | null;
  isMlRunning: boolean;
  onClaim: () => void;
  onSelectedClaimUserIdChange: (value: string) => void;
  onCheckIn: () => void;
  onEnd: () => void;
}) {
  const stateTone =
    session?.status === "NEEDS_CONFIRMATION"
      ? "warning"
      : session
        ? "success"
        : "neutral";
  const confirmationTone = getConfirmationTone(
    derived,
    confirmationWarningMinutes,
    confirmationDangerMinutes,
  );
  const confirmationLabel =
    confirmationTone === "danger"
      ? derived?.isOverdue
        ? "Confirmation overdue"
        : "Action needed now"
      : confirmationTone === "warning"
        ? "Confirm soon"
        : "Next confirmation";
  const confirmationProgress = derived
    ? derived.isOverdue
      ? 0
      : clamp(
          (derived.dueInMs / Math.max(1, checkinIntervalMinutes * 60_000)) *
            100,
        )
    : 0;
  const selectedClaimUser =
    users.find((user) => String(user.id) === selectedClaimUserId) ?? null;

  return (
    <article className="lb-hero-card">
      <div className="lb-card-head">
        <div>
          <p className="lb-kicker">Shift control</p>
          <h2 className="lb-card-title">
            {session ? session.userName : "PC available"}
          </h2>
        </div>
        <StatusPill tone={stateTone} label={session?.status ?? "FREE"} />
      </div>

      {session ? (
        <>
          <div
            className={classNames(
              "lb-session-focus",
              !isMlRunning && `is-${confirmationTone}`,
              isMlRunning && "is-ml",
            )}
          >
            <div>
              <p className="lb-muted">
                {isMlRunning
                  ? "ML/DL workload"
                  : confirmationLabel}
              </p>
              <strong>
                {isMlRunning
                  ? "Code running"
                  : derived
                    ? derived.isOverdue
                      ? `${formatDuration(derived.overdueInMs)} overdue`
                      : `${formatDuration(derived.dueInMs)} left`
                    : "Not set"}
              </strong>
              {!isMlRunning && (
                <div
                  className="lb-confirmation-progress"
                  aria-label={`${Math.round(confirmationProgress)}% of check-in time remaining`}
                >
                  <span style={pctStyle(confirmationProgress)} />
                </div>
              )}
            </div>
            {isMlRunning ? (
              <Activity className="h-8 w-8" aria-hidden="true" />
            ) : (
              <Clock3 className="h-8 w-8" aria-hidden="true" />
            )}
          </div>
          <div className="lb-hero-actions">
            <button
              type="button"
              disabled={busyAction !== null}
              onClick={onCheckIn}
              className="lb-hero-checkin"
            >
              <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
              <span>Still working</span>
            </button>
            <button
              type="button"
              disabled={busyAction !== null}
              onClick={onEnd}
              className="lb-hero-release"
            >
              <LogOut className="h-5 w-5" aria-hidden="true" />
              <span>Release PC</span>
            </button>
          </div>

          <div className="lb-info-row">
            <InfoItem label="Started" value={formatTime(session.startedAt)} />
            <InfoItem
              label="Last check-in"
              value={formatTime(session.lastCheckinAt)}
            />
          </div>
        </>
      ) : (
        <>
          <div className="lb-empty-spot">
            <Zap className="h-7 w-7" aria-hidden="true" />
            <div>
              <p className="font-semibold">Ready for the next user</p>
              <p className="lb-muted">
                Choose a user here and claim the machine directly.
              </p>
            </div>
          </div>
          <div className="lb-claim-controls">
            <div className="lb-claim-picker">
              <label htmlFor="claim-user">Claim as</label>
              <div className="lb-claim-select-row">
                <span className="lb-avatar" aria-hidden="true">
                  {initials(selectedClaimUser?.name ?? "User")}
                </span>
                <select
                  id="claim-user"
                  aria-label="User to claim the PC as"
                  value={selectedClaimUserId}
                  onChange={(event) =>
                    onSelectedClaimUserIdChange(event.target.value)
                  }
                >
                  {users.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <button
              type="button"
              disabled={busyAction !== null || !selectedClaimUserId}
              onClick={onClaim}
              className="lb-hero-checkin lb-hero-claim"
            >
              <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
              <span>
                {selectedClaimUser
                  ? `Claim as ${selectedClaimUser.name}`
                  : "Claim PC"}
              </span>
            </button>
          </div>
        </>
      )}

      <div className="lb-current-slot">
        <CalendarClock className="h-4 w-4" aria-hidden="true" />
        <span>
          {currentSlot
            ? `${currentSlot.userName} is scheduled now`
            : "No scheduled slot right now"}
        </span>
      </div>
    </article>
  );
}

function OperatorPanel({
  users,
  openSession,
  busyAction,
  editingUserId,
  userForm,
  setUserForm,
  onEditUser,
  onCancelEditUser,
  onSubmitUser,
  isAddingUser,
  newUserName,
  onNewUserNameChange,
  onStartAddUser,
  onCancelAddUser,
  onSubmitNewUser,
}: {
  users: UserRecord[];
  openSession: SessionRecord | null;
  busyAction: string | null;
  editingUserId: number | null;
  userForm: { name: string };
  setUserForm: React.Dispatch<React.SetStateAction<{ name: string }>>;
  onEditUser: (user: UserRecord) => void;
  onCancelEditUser: () => void;
  onSubmitUser: () => void;
  isAddingUser: boolean;
  newUserName: string;
  onNewUserNameChange: (value: string) => void;
  onStartAddUser: () => void;
  onCancelAddUser: () => void;
  onSubmitNewUser: () => void;
}) {
  return (
    <article className="lb-panel">
      <div className="lb-card-head">
        <div>
          <p className="lb-kicker">Users</p>
          <h2 className="lb-panel-title">Edit user names</h2>
        </div>
        <button
          type="button"
          className="lb-compact-button lb-add-user-button"
          onClick={onStartAddUser}
          disabled={busyAction !== null || isAddingUser}
          aria-label="Add a new user"
        >
          <UserPlus className="h-4 w-4" aria-hidden="true" />
          <span>Add user</span>
        </button>
      </div>

      <p className="lb-action-hint">
        {openSession
          ? "These names are used for claims, schedules, and activity history."
          : "Manage how users appear in the shift and schedule views."}
      </p>

      {isAddingUser ? (
        <form
          className="lb-user-editor lb-add-user-editor"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmitNewUser();
          }}
        >
          <label>
            <span>Your name</span>
            <input
              autoFocus
              placeholder="e.g. Alex"
              value={newUserName}
              onChange={(event) => onNewUserNameChange(event.target.value)}
              maxLength={80}
            />
          </label>
          <div className="lb-user-editor-actions">
            <button
              type="submit"
              disabled={busyAction !== null || !newUserName.trim()}
            >
              Add
            </button>
            <button type="button" onClick={onCancelAddUser}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      <div className="lb-user-grid">
        {users.map((user) => (
          <div key={user.id} className="lb-user-card">
            <div className="lb-user-row">
              <div className="lb-user-chip lb-user-chip-static">
                <span className="lb-avatar">{initials(user.name)}</span>
                <span>
                  <strong>{user.name}</strong>
                  <small>Used in claims and schedule</small>
                </span>
              </div>
              <button
                type="button"
                className="lb-user-edit-button"
                aria-label={`Edit ${user.name}`}
                disabled={busyAction !== null}
                onClick={() => onEditUser(user)}
              >
                <PencilLine className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            {editingUserId === user.id ? (
              <form
                className="lb-user-editor"
                onSubmit={(event) => {
                  event.preventDefault();
                  onSubmitUser();
                }}
              >
                <label>
                  <span>Name</span>
                  <input
                    value={userForm.name}
                    onChange={(event) =>
                      setUserForm((current) => ({
                        ...current,
                        name: event.target.value,
                      }))
                    }
                  />
                </label>
                <div className="lb-user-editor-actions">
                  <button type="submit" disabled={busyAction !== null}>
                    Save
                  </button>
                  <button type="button" onClick={onCancelEditUser}>
                    Cancel
                  </button>
                </div>
              </form>
            ) : null}
          </div>
        ))}
      </div>
    </article>
  );
}

function SchedulePanel({
  slots,
  users,
  current,
  selection,
  busyAction,
  onChooseDay,
  onCancelEdit,
  onAssign,
  onEdit,
  onDelete,
}: {
  slots: ScheduleSlot[];
  users: UserRecord[];
  current: ScheduleSlot | null;
  selection: { dayOfWeek: number; slotId: number | null } | null;
  busyAction: string | null;
  onChooseDay: (dayOfWeek: number) => void;
  onCancelEdit: () => void;
  onAssign: (userId: number) => void;
  onEdit: (slot: ScheduleSlot) => void;
  onDelete: (id: number) => void;
}) {
  const sortedSlots = [...slots].sort((first, second) => {
    const firstDay = DAY_OPTIONS.findIndex((day) => day.value === first.dayOfWeek);
    const secondDay = DAY_OPTIONS.findIndex(
      (day) => day.value === second.dayOfWeek,
    );

    return (
      firstDay - secondDay ||
      first.startTime.localeCompare(second.startTime) ||
      first.userName.localeCompare(second.userName)
    );
  });
  const slotsByDay = DAY_OPTIONS.map((day) => ({
    ...day,
    slots: sortedSlots.filter((slot) => slot.dayOfWeek === day.value),
  }));

  return (
    <article className="lb-panel lb-schedule-panel">
      <div className="lb-card-head">
        <div>
          <p className="lb-kicker">Weekly schedule</p>
          <h2 className="lb-panel-title">
            {current ? current.userName : "No current slot"}
          </h2>
        </div>
      </div>

      <div className="lb-week-list">
        {slotsByDay.map((day) => (
          <section key={day.value} className="lb-day-row">
            <div className="lb-day-label">
              <strong>{day.label}</strong>
            </div>
            <div className="lb-slot-list">
              {day.slots.length === 0 ? (
                <button
                  type="button"
                  disabled={busyAction !== null}
                  className="lb-free-slot"
                  onClick={() => onChooseDay(day.value)}
                >
                  Assign
                </button>
              ) : (
                day.slots.map((slot) => (
                  <div
                    key={slot.id}
                    className={classNames(
                      "lb-slot-row",
                      current?.id === slot.id && "is-current",
                      selection?.slotId === slot.id && "is-editing",
                    )}
                  >
                    <strong>{slot.userName}</strong>
                    <div className="lb-slot-actions">
                      <button
                        type="button"
                        aria-label={`Change ${slot.userName} schedule slot`}
                        disabled={busyAction !== null}
                        onClick={() => onEdit(slot)}
                      >
                        <PencilLine className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete ${slot.userName} schedule slot`}
                        disabled={busyAction !== null}
                        onClick={() => onDelete(slot.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        ))}
      </div>
    </article>
  );
}

function SchedulePickerModal({
  users,
  busyAction,
  isChanging,
  onAssign,
  onCancel,
  onSubmitNewUser,
}: {
  users: UserRecord[];
  busyAction: string | null;
  isChanging: boolean;
  onAssign: (userId: number) => void;
  onCancel: () => void;
  onSubmitNewUser: (name: string) => Promise<void>;
}) {
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    const trimmed = newName.trim();
    if (!trimmed || creating) {
      return;
    }
    setCreating(true);
    try {
      await onSubmitNewUser(trimmed);
    } finally {
      setCreating(false);
      setNewName("");
    }
  };

  return (
    <div className="lb-modal-backdrop" onClick={onCancel}>
      <div
        className="lb-modal"
        role="dialog"
        aria-label={isChanging ? "Change day owner" : "Assign a user"}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="lb-modal-head">
          <strong>{isChanging ? "Change day owner" : "Assign a user"}</strong>
          <button
            type="button"
            className="lb-modal-close"
            onClick={onCancel}
            aria-label="Cancel"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="lb-modal-body">
          <div className="lb-modal-user-list">
            {users.map((user) => (
              <button
                key={user.id}
                type="button"
                className="lb-modal-user-btn"
                disabled={busyAction !== null}
                onClick={() => onAssign(user.id)}
              >
                <span className="lb-avatar">{initials(user.name)}</span>
                <div>
                  <strong>{user.name}</strong>
                  <small>Available for schedule</small>
                </div>
              </button>
            ))}
            {users.length === 0 && (
              <p className="lb-muted">No users yet. Add one below.</p>
            )}
          </div>

          <div className="lb-modal-divider" />

          <form
            className="lb-modal-add-user"
            onSubmit={(e) => {
              e.preventDefault();
              void handleCreate();
            }}
          >
            <label>
              <span>Add new user</span>
              <input
                autoFocus={users.length === 0}
                placeholder="e.g. Alex"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                maxLength={80}
              />
            </label>
            <button
              type="submit"
              disabled={busyAction !== null || !newName.trim() || creating}
            >
              {creating ? "Adding…" : "Add & assign"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function WeeklyOverviewPanel({ weekly }: { weekly: GpuWeeklyPoint[] }) {
  const busiestGpu = weekly.reduce<GpuWeeklyPoint | null>((best, point) => {
    if (point.gpuAverage === null) {
      return best;
    }

    if (best?.gpuAverage === null || best === null) {
      return point;
    }

    return point.gpuAverage > best.gpuAverage ? point : best;
  }, null);
  const busiestMl = weekly.reduce<GpuWeeklyPoint | null>((best, point) => {
    if (point.mlPercent === 0) {
      return best;
    }

    if (best === null) {
      return point;
    }

    return point.mlPercent > best.mlPercent ? point : best;
  }, null);

  return (
    <section className="lb-weekly-overview" aria-label="Weekly GPU overview">
      <article className="lb-panel lb-weekly-panel">
        <div className="lb-card-head">
          <div>
            <p className="lb-kicker">Weekly overview</p> 
          </div>
          <Activity className="h-5 w-5 text-[var(--muted)]" aria-hidden="true" />
        </div>
 
        <div className="lb-weekly-chart-grid">
          <WeeklyUsageChart
            label="GPU average by day"
            tone="gpu"
            points={weekly}
            getValue={(point) => point.gpuAverage}
            getDetail={(point) =>
              point.gpuAverage === null
                ? "No samples"
                : `${point.gpuAverage}% avg, ${point.gpuPeak ?? 0}% peak`
            }
          />
          <WeeklyUsageChart
            label="ML/DL activity by day"
            tone="ml"
            points={weekly}
            getValue={(point) => point.mlPercent}
            getDetail={(point) =>
              `${point.mlPercent}% active, ${point.mlBucketCount}/${point.bucketCount} buckets`
            }
          />
        </div>
      </article>
    </section>
  );
}

function WeeklyUsageChart({
  label,
  tone,
  points,
  getValue,
  getDetail,
}: {
  label: string;
  tone: "gpu" | "ml";
  points: GpuWeeklyPoint[];
  getValue: (point: GpuWeeklyPoint) => number | null;
  getDetail: (point: GpuWeeklyPoint) => string;
}) {
  const latestIndex = points.length > 0 ? points.length - 1 : null;
  const [activeIndex, setActiveIndex] = useState<number | null>(latestIndex);
  const activePoint =
    activeIndex !== null && points[activeIndex] ? points[activeIndex] : null;
  const activeValue = activePoint ? getValue(activePoint) : null;

  return (
    <div className={classNames("lb-weekly-chart", `is-${tone}`)}>
      <div className="lb-weekly-chart-head">
        <div>
          <span>{label}</span>
          <small>
            {activePoint
              ? `${formatWeekday(activePoint.date)}, ${formatShortDate(activePoint.date)}`
              : "Saturday to Friday"}
          </small>
        </div>
        <strong>
          {activeValue === null ? "No data" : `${Math.round(clamp(activeValue))}%`}
        </strong>
      </div>

      <div className="lb-weekly-bars" onPointerLeave={() => setActiveIndex(null)}>
        {points.map((point, index) => {
          const rawValue = getValue(point);
          const value = rawValue === null ? 0 : Math.round(clamp(rawValue));

          return (
            <button
              key={`${label}-${point.date}`}
              type="button"
              className={classNames(
                "lb-weekly-day-bar",
                activePoint?.date === point.date && "is-selected",
                rawValue === null && "is-empty",
              )}
              onPointerEnter={() => setActiveIndex(index)}
              onFocus={() => setActiveIndex(index)}
              onBlur={() => setActiveIndex(null)}
              title={`${formatWeekday(point.date)}: ${getDetail(point)}`}
              aria-label={`${formatWeekday(point.date)} ${getDetail(point)}`}
            >
              <span className="lb-weekly-bar-track" aria-hidden="true">
                <span style={pctStyle(value)} />
              </span>
              <span className="lb-weekly-day-label">
                {formatWeekday(point.date)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TodayPanel({ sessions }: { sessions: SessionRecord[] }) {
  return (
    <article className="lb-panel">
      <div className="lb-card-head">
        <div>
          <p className="lb-kicker">Today</p>
          <h2 className="lb-panel-title">Usage timeline</h2>
        </div>
        <Clock3 className="h-5 w-5 text-[var(--muted)]" aria-hidden="true" />
      </div>

      <div className="lb-timeline">
        {sessions.length === 0 ? (
          <EmptyLine text="No sessions today" />
        ) : (
          sessions.map((session) => (
            <div key={session.id} className="lb-timeline-row">
              <span
                className={classNames(
                  "lb-dot",
                  session.status === "ACTIVE" && "is-good",
                  session.status === "NEEDS_CONFIRMATION" && "is-warning",
                  session.status === "INACTIVE" && "is-danger",
                )}
              />
              <div>
                <strong>{session.userName}</strong>
                <p>
                  {formatDateTime(session.startedAt)} -{" "}
                  {session.endedAt ? formatTime(session.endedAt) : "now"}
                </p>
              </div>
              <StatusPill tone="neutral" label={session.status} />
            </div>
          ))
        )}
      </div>
    </article>
  );
}

function EventsPanel({ events }: { events: EventRecord[] }) {
  return (
    <article className="lb-panel">
      <div className="lb-card-head">
        <div>
          <p className="lb-kicker">Activity log</p>
          <h2 className="lb-panel-title">Recent events</h2>
        </div>
        <Signal className="h-5 w-5 text-[var(--muted)]" aria-hidden="true" />
      </div>

      <div className="lb-event-list">
        {events.length === 0 ? (
          <EmptyLine text="No events yet" />
        ) : (
          events.map((event) => (
            <div key={event.id} className="lb-event-row">
              <EventIcon type={event.type} />
              <div>
                <p>{event.message}</p>
                <span>{formatDateTime(event.createdAt)}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </article>
  );
}

function SystemPanel({
  pollSeconds,
  threshold,
  windowMinutes,
  activeRatio,
  consecutiveSamples,
  activity,
  processActivity,
  lastUpdateAge,
  sampleAgeMs,
}: {
  pollSeconds: number;
  threshold: number;
  windowMinutes: number;
  activeRatio: number;
  consecutiveSamples: number;
  activity: StatusResponse["gpu"]["activity"];
  processActivity: StatusResponse["gpu"]["processActivity"];
  lastUpdateAge: number | null;
  sampleAgeMs: number | null;
}) {
  return (
    <article className="lb-panel lb-system-panel">
      <div className="lb-card-head">
        <div>
          <p className="lb-kicker">Monitor rules</p>
          <h2 className="lb-panel-title">Idle protection</h2>
        </div>
        <Database className="h-5 w-5 text-[var(--muted)]" aria-hidden="true" />
      </div>
      <div className="lb-rule-grid">
        <InfoItem label="Dashboard poll" value={`${REFRESH_MS / 1000}s`} />
        <InfoItem label="Worker poll" value={`${pollSeconds}s`} />
        <InfoItem label="Busy threshold" value={`${threshold}% GPU`} />
        <InfoItem label="Window" value={`${windowMinutes}m samples`} />
        <InfoItem
          label="Needed ratio"
          value={`${Math.round(activeRatio * 100)}% active`}
        />
        <InfoItem
          label="Needed streak"
          value={`${consecutiveSamples} in a row`}
        />
        <InfoItem
          label="UI refreshed"
          value={lastUpdateAge === null ? "Waiting" : formatAge(lastUpdateAge)}
        />
        <InfoItem
          label="GPU sampled"
          value={sampleAgeMs === null ? "Waiting" : formatAge(sampleAgeMs)}
        />
        <InfoItem
          label="Current ratio"
          value={`${Math.round(activity.activeSampleRatio * 100)}% active`}
        />
        <InfoItem
          label="Current streak"
          value={`${activity.consecutiveActiveSamples} samples`}
        />
        <InfoItem
          label="ML/DL signal"
          value={
            processActivity.isLikelyMlWorkload
              ? `${processActivity.likelyMlProcessCount} process`
              : "None"
          }
        />
        <InfoItem
          label="ML/DL VRAM"
          value={formatMemory(processActivity.likelyMlUsedMemoryMb)}
        />
      </div>
    </article>
  );
}

function StatusPill({
  tone,
  label,
}: {
  tone: "success" | "warning" | "danger" | "neutral";
  label: string;
}) {
  return <span className={classNames("lb-pill", `is-${tone}`)}>{label}</span>;
}

function LiveBadge({ isLive }: { isLive: boolean }) {
  return (
    <span className={classNames("lb-live-badge", isLive && "is-live")}>
      <span />
      {isLive ? "Live" : "Offline"}
    </span>
  );
}

function PanelButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={classNames("lb-tab-button", active && "is-active")}
    >
      {label}
    </button>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="lb-info-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function EventIcon({ type }: { type: string }) {
  if (type.includes("INACTIVE") || type.includes("UNCLAIMED")) {
    return <CircleAlert className="h-4 w-4 text-[var(--warning)]" />;
  }

  if (
    type.includes("START") ||
    type.includes("CHECK") ||
    type.includes("CLAIM") ||
    type.includes("RENEW")
  ) {
    return <CircleCheck className="h-4 w-4 text-[var(--ok)]" />;
  }

  return <Activity className="h-4 w-4 text-[var(--muted)]" />;
}

function EmptyLine({ text }: { text: string }) {
  return <p className="lb-empty-line">{text}</p>;
}
