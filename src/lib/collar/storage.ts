"use client";

import {
  CollarTrainingConfigSchema,
  CollarSettingsSchema,
  DEFAULT_POLLING,
  DEFAULT_PROFILE,
  DEFAULT_SETTINGS,
  DEFAULT_TRAINING_CONFIG,
  EMPTY_STATS,
  PollingConfigSchema,
  ProfileConfigSchema,
  PunishmentDebtSchema,
  TrainingTaskSchema,
  type CollarState,
  type TrainingRecord
} from "./schema";

export const COLLAR_STORAGE_KEY = "collar.state.v1";

export function defaultCollarState(): CollarState {
  return {
    version: 3,
    profile: { ...DEFAULT_PROFILE },
    trainingConfig: structuredClone(DEFAULT_TRAINING_CONFIG),
    settings: { ...DEFAULT_SETTINGS },
    polling: { ...DEFAULT_POLLING },
    stats: { ...EMPTY_STATS },
    activeTask: null,
    records: [],
    punishments: [],
    lastDailyState: "",
    lastDesiredModes: [],
    lastPollAt: ""
  };
}

function recordLooksValid(record: unknown): record is TrainingRecord {
  if (!record || typeof record !== "object") return false;
  const value = record as Partial<TrainingRecord>;
  return Boolean(value.date && value.taskId && value.title && value.type && value.completedAt && value.statDelta && value.reward);
}

export function parseCollarState(raw: unknown, current = defaultCollarState()): CollarState {
  const value = raw && typeof raw === "object" ? raw as Partial<CollarState> : {};
  const profile = ProfileConfigSchema.safeParse(value.profile);
  const trainingConfig = CollarTrainingConfigSchema.safeParse(value.trainingConfig);
  const settings = CollarSettingsSchema.safeParse(value.settings);
  const polling = PollingConfigSchema.safeParse(value.polling);
  const activeTask = value.activeTask && TrainingTaskSchema.safeParse(value.activeTask.task).success
    ? {
      ...value.activeTask,
      correctionKind: value.activeTask.correctionKind
        || (value.activeTask.punishmentId ? "punishment" as const : undefined)
    }
    : null;
  const records = Array.isArray(value.records) ? value.records.filter(recordLooksValid).slice(-1000) : current.records;
  const punishments = Array.isArray(value.punishments)
    ? value.punishments.flatMap((punishment) => {
      const parsed = PunishmentDebtSchema.safeParse(punishment);
      return parsed.success ? [parsed.data] : [];
    }).slice(-500)
    : current.punishments;
  return {
    version: 3,
    profile: profile.success ? profile.data : current.profile,
    trainingConfig: trainingConfig.success ? trainingConfig.data : current.trainingConfig,
    settings: settings.success ? settings.data : current.settings,
    polling: polling.success ? polling.data : current.polling,
    stats: {
      ...EMPTY_STATS,
      ...(value.stats && typeof value.stats === "object" ? value.stats : current.stats)
    },
    activeTask,
    records,
    punishments,
    lastDailyState: String(value.lastDailyState || ""),
    lastDesiredModes: Array.isArray(value.lastDesiredModes) ? value.lastDesiredModes.map(String).slice(0, 6) : [],
    lastPollAt: String(value.lastPollAt || "")
  };
}

export function loadCollarState() {
  if (typeof window === "undefined") return defaultCollarState();
  try {
    const raw = window.localStorage.getItem(COLLAR_STORAGE_KEY);
    return raw ? parseCollarState(JSON.parse(raw)) : defaultCollarState();
  } catch (error) {
    console.error("[collar] failed to load local state", error);
    return defaultCollarState();
  }
}

export function saveCollarState(state: CollarState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(COLLAR_STORAGE_KEY, JSON.stringify(state));
}

export function exportableState(state: CollarState) {
  return {
    ...state,
    exportedAt: new Date().toISOString(),
    settings: {
      ...state.settings,
      apiKey: ""
    }
  };
}
