import {
  EMPTY_STATS,
  type CollarSettings,
  type PunishmentDebt,
  type TaskRuntime,
  type TrainingRecord,
  type TrainingTask,
  type TrainingVerdict
} from "./schema";
import { shiftDate } from "./history";

const UTC8_OFFSET_MS = 8 * 60 * 60 * 1000;
export const MAX_PUNISHMENT_ATTEMPTS = 2;

function startMinutes(value: string) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : 8 * 60;
}

export function trainingDayKey(date = new Date(), start = "08:00") {
  const shifted = new Date(date.getTime() + UTC8_OFFSET_MS - startMinutes(start) * 60_000);
  return shifted.toISOString().slice(0, 10);
}

export function utc8ClockMinutes(date = new Date()) {
  const utc8 = new Date(date.getTime() + UTC8_OFFSET_MS);
  return utc8.getUTCHours() * 60 + utc8.getUTCMinutes();
}

export function trainingDayDistance(from: string, to: string) {
  if (from === to) return 0;
  let cursor = from;
  for (let distance = 1; distance <= 3660; distance += 1) {
    cursor = shiftDate(cursor, 1);
    if (cursor === to) return distance;
    if (cursor > to) return -1;
  }
  return -1;
}

export function punishmentAge(debt: PunishmentDebt, currentTrainingDay: string) {
  return Math.max(0, trainingDayDistance(debt.assignedTrainingDay, currentTrainingDay));
}

export function pendingPunishments(punishments: PunishmentDebt[]) {
  return punishments
    .filter((punishment) => punishment.status === "pending")
    .sort((left, right) => left.assignedAt.localeCompare(right.assignedAt));
}

export function nextCorrectionKind(debt: PunishmentDebt): "makeup" | "punishment" {
  return debt.makeup && debt.makeupStatus === "pending" ? "makeup" : "punishment";
}

export function punishmentPointPenalty(debt: PunishmentDebt) {
  return Math.max(1, Math.min(5, debt.assignment.intensity));
}

export function hasAcceptedTrainingOnDay(
  records: TrainingRecord[],
  activeTask: TaskRuntime | null,
  trainingDay: string
) {
  return records.some((record) => record.date === trainingDay && !record.isPunishment && !record.correctionKind)
    || Boolean(activeTask && !activeTask.punishmentId && activeTask.task.date === trainingDay);
}

export function punishmentPolicy(
  punishments: PunishmentDebt[],
  currentTrainingDay: string,
  now = new Date()
) {
  const pending = pendingPunishments(punishments);
  const ages = pending.map((punishment) => punishmentAge(punishment, currentTrainingDay));
  const oldestAge = ages.length ? Math.max(...ages) : -1;
  return {
    pending,
    oldestAge,
    remindTonight: ages.some((age) => age === 0) && utc8ClockMinutes(now) >= 22 * 60,
    persistent: oldestAge >= 1,
    blocksTraining: oldestAge >= 2
  };
}

export function createPunishmentDebt(input: {
  verdict: TrainingVerdict;
  sourceTaskId: string;
  assignedTrainingDay: string;
  source: TaskRuntime["source"];
  assignedAt?: string;
}): PunishmentDebt {
  if (input.verdict.status !== "punishment" || !input.verdict.makeup || !input.verdict.punishment) {
    throw new Error("failed training verdict requires makeup and punishment");
  }
  const assignedAt = input.assignedAt || new Date().toISOString();
  return {
    id: `punishment-${input.sourceTaskId}-${assignedAt}`,
    sourceTaskId: input.sourceTaskId,
    assignedTrainingDay: input.assignedTrainingDay,
    assignedAt,
    status: "pending",
    makeup: input.verdict.makeup,
    makeupStatus: "pending",
    assignment: input.verdict.punishment,
    punishmentStatus: "pending",
    source: input.source,
    failureCount: 0,
    pointPenalty: 0
  };
}

function correctionTask(
  assignment: PunishmentDebt["assignment"],
  debt: PunishmentDebt,
  currentTrainingDay: string,
  settings: Pick<CollarSettings, "allowHiddenTimer" | "hiddenTimerMaxSeconds">,
  kind: "makeup" | "punishment"
): TrainingTask {
  const timerEnabled = assignment.timer.enabled;
  const maxSeconds = timerEnabled
    ? Math.min(assignment.timer.maxSeconds, settings.hiddenTimerMaxSeconds)
    : 0;
  const minSeconds = timerEnabled
    ? Math.min(assignment.timer.minSeconds, maxSeconds)
    : 0;
  const makeup = kind === "makeup";
  return {
    taskId: `${makeup ? "makeup" : "debt"}:${debt.id}`,
    date: currentTrainingDay,
    title: assignment.title,
    type: "mixed",
    intensity: assignment.intensity,
    triggerWord: makeup ? "补齐" : "偿还",
    ownerResponse: assignment.reason,
    openingCommand: assignment.openingCommand,
    description: makeup
      ? "这是原任务缺失部分的补交。只补验收中确认没有完成的项目；补齐后，独立惩罚仍需另行完成。"
      : "这是依据 Shape Your Pet / Punishment 生成的独立惩罚。完成并再次交给主人判定后才会从欠账中划掉。",
    steps: assignment.steps,
    timer: {
      ...assignment.timer,
      enabled: timerEnabled,
      hidden: timerEnabled && settings.allowHiddenTimer && assignment.timer.hidden,
      minSeconds,
      maxSeconds
    },
    report: assignment.report,
    completionText: assignment.completionText,
    statDelta: makeup
      ? { ...EMPTY_STATS, obedience: 1, resistance: -1 }
      : { ...EMPTY_STATS, obedience: 1, resistance: -1, badCat: -1 },
    reward: {
      type: "aftercare",
      delaySeconds: 0,
      text: makeup
        ? "缺失项已经补齐。接下来偿还主人判下的惩罚。"
        : "这笔已经偿还。欠账从档案里划掉。"
    },
    safety: {
      requiresPrivateSpace: true,
      allowsEmergencyExit: true,
      notes: "纠正任务同样可以随时安全停止；停止不会新增惩罚，但当前项目仍保持未完成。"
    }
  };
}

export function makeupTask(
  debt: PunishmentDebt,
  currentTrainingDay: string,
  settings: Pick<CollarSettings, "allowHiddenTimer" | "hiddenTimerMaxSeconds">
) {
  if (!debt.makeup) throw new Error("makeup assignment missing");
  return correctionTask(debt.makeup, debt, currentTrainingDay, settings, "makeup");
}

export function punishmentTask(
  debt: PunishmentDebt,
  currentTrainingDay: string,
  settings: Pick<CollarSettings, "allowHiddenTimer" | "hiddenTimerMaxSeconds">
): TrainingTask {
  return correctionTask(debt.assignment, debt, currentTrainingDay, settings, "punishment");
}
