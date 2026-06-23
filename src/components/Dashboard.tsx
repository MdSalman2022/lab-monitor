"use client";

import type { CSSProperties } from "react";
import {
  Activity,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Clock3,
  Cpu,
  Database,
  Gauge,
  HardDrive,
  LogOut,
  PencilLine,
  Radio,
  RefreshCw,
  Signal,
  Trash2,
  WifiOff,
  X,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

type UserRecord = {
  id: number;
  name: string;
  telegramTag: string | null;
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

type StatusResponse = {
  now: string;
  config: {
    checkinIntervalMinutes: number;
    graceMinutes: number;
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

type Panel = "operate" | "schedule" | "log";
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
const ONE_HOUR_MS = 60 * 60_000;
const TWO_HOURS_MS = 2 * 60 * 60_000;

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

  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
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
): ConfirmationTone {
  if (!derived) {
    return "normal";
  }

  if (derived.isOverdue || derived.dueInMs < ONE_HOUR_MS) {
    return "danger";
  }

  if (derived.dueInMs < TWO_HOURS_MS) {
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
  const [editingUserId, setEditingUserId] = useState<number | null>(null);
  const [userForm, setUserForm] = useState({ name: "", telegramTag: "" });
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [clientNow, setClientNow] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    try {
      const nextStatus = await requestJson<StatusResponse>("/api/status", {
        cache: "no-store",
      });
      setStatus(nextStatus);
      setError(null);
      setLastUpdatedAt(Date.now());
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not load LabBeacon status",
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
      telegramTag: user.telegramTag ?? "",
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
          telegramTag: userForm.telegramTag,
        }),
      });
      setEditingUserId(null);
    });
  };

  return (
    <main className="lb-shell">
      <section className="lb-topbar">
        <div>
          <p className="lb-kicker">LabBeacon</p>
          <h1 className="lb-title">Lab GPU status</h1>
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

      <section className="lb-telemetry-grid" aria-label="Live telemetry">
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
          recent={status.gpu.recent}
        />

        <SessionHero
          session={openSession}
          derived={derived}
          currentSlot={status.schedule.current}
          checkinIntervalMinutes={status.config.checkinIntervalMinutes}
          busyAction={busyAction}
          onCheckIn={handleCheckIn}
          onEnd={handleEnd}
        />
      </section>

      <section className="lb-mobile-tabs" aria-label="Dashboard panels">
        <PanelButton
          active={activePanel === "operate"}
          label="Operate"
          onClick={() => setActivePanel("operate")}
        />
        <PanelButton
          active={activePanel === "schedule"}
          label="Schedule"
          onClick={() => setActivePanel("schedule")}
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
            onStart={(userId) =>
              void runAction(`start-${userId}`, () =>
                requestJson("/api/sessions/claim", {
                  method: "POST",
                  body: JSON.stringify({ userId }),
                }),
              )
            }
          />

          <TodayPanel sessions={status.today.sessions} />
        </div>

        <div
          className={classNames(
            "lb-panel-stack",
            activePanel !== "schedule" && "lb-mobile-hidden",
          )}
        >
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
        </div>

        <div
          className={classNames(
            "lb-panel-stack",
            activePanel !== "log" && "lb-mobile-hidden",
          )}
        >
          <EventsPanel events={status.events} />
          <SystemPanel
            pollSeconds={status.config.pollSeconds}
            threshold={status.config.gpuIdleThreshold}
            windowMinutes={status.config.gpuIdleWindowMinutes}
            activeRatio={status.config.gpuBusyMinActiveRatio}
            consecutiveSamples={status.config.gpuBusyMinConsecutiveSamples}
            activity={status.gpu.activity}
            lastUpdateAge={lastUpdateAge}
            sampleAgeMs={sampleAgeMs}
          />
        </div>
      </section>
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
          <p className="lb-kicker">LabBeacon</p>
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
  recent,
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
  recent: GpuSample[];
}) {
  return (
    <article className="lb-hero-card lb-telemetry-card">
      <div className="lb-card-head">
        <div>
          <p className="lb-kicker">Live hardware</p>
          <h2 className="lb-card-title">GPU and VRAM</h2>
        </div>
        <StatusPill
          tone={isGpuBusy ? "success" : hasBurstOnly ? "warning" : "neutral"}
          label={
            isGpuBusy
              ? "Sustained activity"
              : hasBurstOnly
                ? "Short spike only"
                : "Idle pattern"
          }
        />
      </div>

      <div className="lb-meter-grid">
        <GaugeDial
          label="GPU"
          value={gpuUtil}
          detail={`Avg ${averageUtil ?? "-"}% • ${activity.consecutiveActiveSamples} active samples in a row`}
          icon={<Gauge className="h-5 w-5" aria-hidden="true" />}
          tone="gpu"
        />
        <GaugeDial
          label="VRAM"
          value={memoryPercent}
          detail={`${formatMemory(memoryUsed)} / ${memoryTotal ? formatMemory(memoryTotal) : "unknown"}`}
          icon={<HardDrive className="h-5 w-5" aria-hidden="true" />}
          tone="memory"
        />
      </div>

      <div className="lb-telemetry-footer">
        <div className="lb-history-grid">
          <UsageChart
            label="GPU"
            tone="gpu"
            samples={recent}
            getValue={(sample) => sample.gpuUtil}
            threshold={activity.threshold}
          />
          <UsageChart
            label="VRAM"
            tone="memory"
            samples={recent}
            getValue={(sample) =>
              sample.memoryTotalMb > 0
                ? (sample.memoryUsedMb / sample.memoryTotalMb) * 100
                : 0
            }
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

function UsageChart({
  label,
  tone,
  samples,
  getValue,
  threshold,
}: {
  label: string;
  tone: "gpu" | "memory";
  samples: GpuSample[];
  getValue: (sample: GpuSample) => number;
  threshold?: number;
}) {
  const visibleSamples = samples.slice(-42);
  const latestValue =
    visibleSamples.length > 0
      ? Math.round(clamp(getValue(visibleSamples[visibleSamples.length - 1])))
      : null;

  return (
    <div className={classNames("lb-usage-chart", `is-${tone}`)}>
      <div className="lb-usage-chart-head">
        <span>{label}</span>
        <strong>{latestValue === null ? "No data" : `${latestValue}%`}</strong>
      </div>
      <div
        className="lb-sample-strip"
        aria-label={`Recent ${label} usage samples`}
      >
        {threshold !== undefined ? (
          <span
            className="lb-threshold-line"
            style={pctStyle(threshold)}
            aria-hidden="true"
          />
        ) : null}
        {visibleSamples.length === 0 ? (
          <span className="lb-muted">Waiting for samples</span>
        ) : (
          visibleSamples.map((sample) => {
            const value = Math.round(clamp(getValue(sample)));

            return (
              <span
                key={`${label}-${sample.sampledAt}-${sample.gpuUtil}-${sample.memoryUsedMb}`}
                className="lb-sample-bar"
                style={pctStyle(value)}
                title={`${label} ${value}% at ${formatTime(sample.sampledAt)}`}
              />
            );
          })
        )}
      </div>
      {threshold !== undefined ? (
        <p className="lb-chart-note">{threshold}% idle threshold</p>
      ) : (
        <p className="lb-chart-note">Memory pressure</p>
      )}
    </div>
  );
}

function GaugeDial({
  label,
  value,
  detail,
  icon,
  tone,
}: {
  label: string;
  value: number;
  detail: string;
  icon: React.ReactNode;
  tone: "gpu" | "memory";
}) {
  const rounded = Math.round(clamp(value));

  return (
    <div className={classNames("lb-gauge-card", `lb-gauge-${tone}`)}>
      <div className="lb-gauge-ring" style={pctStyle(rounded)}>
        <div className="lb-gauge-inner">
          <span>{icon}</span>
          <strong>{rounded}%</strong>
        </div>
      </div>
      <div>
        <p className="lb-gauge-label">{label}</p>
        <p className="lb-muted">{detail}</p>
        <span className="lb-gauge-progress" aria-hidden="true">
          <span style={pctStyle(rounded)} />
        </span>
      </div>
    </div>
  );
}

function SessionHero({
  session,
  derived,
  currentSlot,
  checkinIntervalMinutes,
  busyAction,
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
  busyAction: string | null;
  onCheckIn: () => void;
  onEnd: () => void;
}) {
  const stateTone =
    session?.status === "NEEDS_CONFIRMATION"
      ? "warning"
      : session
        ? "success"
        : "neutral";
  const confirmationTone = getConfirmationTone(derived);
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
              `is-${confirmationTone}`,
            )}
          >
            <div>
              <p className="lb-muted">{confirmationLabel}</p>
              <strong>
                {derived
                  ? derived.isOverdue
                    ? `${formatDuration(derived.overdueInMs)} overdue`
                    : `${formatDuration(derived.dueInMs)} left`
                  : "Not set"}
              </strong>
              <div
                className="lb-confirmation-progress"
                aria-label={`${Math.round(confirmationProgress)}% of check-in time remaining`}
              >
                <span style={pctStyle(confirmationProgress)} />
              </div>
            </div>
            <Clock3 className="h-8 w-8" aria-hidden="true" />
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
        <div className="lb-empty-spot">
          <Zap className="h-7 w-7" aria-hidden="true" />
          <div>
            <p className="font-semibold">Ready for the next user</p>
            <p className="lb-muted">
              Claim the machine below before starting a long run.
            </p>
          </div>
        </div>
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
  onStart,
}: {
  users: UserRecord[];
  openSession: SessionRecord | null;
  busyAction: string | null;
  editingUserId: number | null;
  userForm: { name: string; telegramTag: string };
  setUserForm: React.Dispatch<
    React.SetStateAction<{ name: string; telegramTag: string }>
  >;
  onEditUser: (user: UserRecord) => void;
  onCancelEditUser: () => void;
  onSubmitUser: () => void;
  onStart: (userId: number) => void;
}) {
  return (
    <article className="lb-panel">
      <div className="lb-card-head">
        <div>
          <p className="lb-kicker">Quick actions</p>
          <h2 className="lb-panel-title">Claim PC</h2>
        </div>
        <Activity className="h-5 w-5 text-[var(--muted)]" aria-hidden="true" />
      </div>

      <p className="lb-action-hint">
        {openSession
          ? "The machine is occupied. These users can claim it after release."
          : "Tap your name to claim the machine before starting work."}
      </p>

      <div className="lb-user-grid">
        {users.map((user) => (
          <div key={user.id} className="lb-user-card">
            <div className="lb-user-row">
              <button
                type="button"
                disabled={busyAction !== null}
                onClick={() => onStart(user.id)}
                className="lb-user-chip"
              >
                <span className="lb-avatar">{initials(user.name)}</span>
                <span>
                  <strong>{user.name}</strong>
                  <small>{openSession ? "Waiting" : "Tap to claim"}</small>
                </span>
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </button>
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
                <label>
                  <span>Telegram</span>
                  <input
                    value={userForm.telegramTag}
                    placeholder="@username"
                    onChange={(event) =>
                      setUserForm((current) => ({
                        ...current,
                        telegramTag: event.target.value,
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
    <article className="lb-panel">
      <div className="lb-card-head">
        <div>
          <p className="lb-kicker">Weekly rota</p>
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
              <span>{day.slots.length === 0 ? "Free" : `${day.slots.length} slot${day.slots.length === 1 ? "" : "s"}`}</span>
            </div>
            <div className="lb-slot-list">
              {day.slots.length === 0 ? (
                <button
                  type="button"
                  disabled={busyAction !== null}
                  className="lb-free-slot"
                  onClick={() => onChooseDay(day.value)}
                >
                  Open for anyone
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
                    <div>
                      <strong>{slot.userName}</strong>
                      <span>
                        {slot.startTime}-{slot.endTime}
                      </span>
                    </div>
                    <div className="lb-slot-actions">
                      <button
                        type="button"
                        aria-label={`Change ${slot.userName} schedule slot`}
                        disabled={busyAction !== null}
                        onClick={() => onEdit(slot)}
                      >
                        <PencilLine className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete ${slot.userName} schedule slot`}
                        disabled={busyAction !== null}
                        onClick={() => onDelete(slot.id)}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                ))
              )}
              {selection?.dayOfWeek === day.value ? (
                <ResearcherPicker
                  users={users}
                  busyAction={busyAction}
                  isChanging={selection.slotId !== null}
                  onAssign={onAssign}
                  onCancel={onCancelEdit}
                />
              ) : null}
            </div>
          </section>
        ))}
      </div>
    </article>
  );
}

function ResearcherPicker({
  users,
  busyAction,
  isChanging,
  onAssign,
  onCancel,
}: {
  users: UserRecord[];
  busyAction: string | null;
  isChanging: boolean;
  onAssign: (userId: number) => void;
  onCancel: () => void;
}) {
  return (
    <div className="lb-researcher-picker">
      <div className="lb-picker-head">
        <strong>{isChanging ? "Change day owner" : "Choose researcher"}</strong>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
      <div className="lb-picker-grid">
        {users.map((user) => (
          <button
            key={user.id}
            type="button"
            disabled={busyAction !== null}
            onClick={() => onAssign(user.id)}
          >
            <span className="lb-avatar">{initials(user.name)}</span>
            <span>{user.name}</span>
          </button>
        ))}
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
  lastUpdateAge,
  sampleAgeMs,
}: {
  pollSeconds: number;
  threshold: number;
  windowMinutes: number;
  activeRatio: number;
  consecutiveSamples: number;
  activity: StatusResponse["gpu"]["activity"];
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

  if (type.includes("START") || type.includes("CHECK") || type.includes("CLAIM")) {
    return <CircleCheck className="h-4 w-4 text-[var(--ok)]" />;
  }

  return <Activity className="h-4 w-4 text-[var(--muted)]" />;
}

function EmptyLine({ text }: { text: string }) {
  return <p className="lb-empty-line">{text}</p>;
}
