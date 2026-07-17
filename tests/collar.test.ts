import assert from "node:assert/strict";
import test from "node:test";
import { calculateCheckIn, localDateKey, shiftDate, summarizeRecentHistory } from "../src/lib/collar/history";
import {
  createPunishmentDebt,
  hasAcceptedTrainingOnDay,
  punishmentPolicy,
  trainingDayKey
} from "../src/lib/collar/discipline";
import { generateMockTask } from "../src/lib/collar/mock";
import { generateVerdict } from "../src/lib/collar/ai-client";
import {
  COLLAR_PURPOSE,
  CollarFourBlockImportSchema,
  CollarTrainingConfigSchema,
  DEFAULT_PROFILE,
  DEFAULT_SETTINGS,
  DEFAULT_TRAINING_CONFIG,
  EMPTY_STATS,
  ProfileConfigSchema,
  TrainingTaskSchema,
  TrainingVerdictSchema,
  type TaskGenerationContext,
  type TrainingRecord
} from "../src/lib/collar/schema";
import { parseStrictJson, resolveTimerBounds, resolveTimerVisibility } from "../src/lib/collar/validation";
import { defaultCollarState, parseCollarState } from "../src/lib/collar/storage";

function record(date: string, overrides: Partial<TrainingRecord> = {}): TrainingRecord {
  return {
    date,
    taskId: `task-${date}`,
    title: "测试任务",
    type: "hiddenTimer",
    intensity: 3,
    triggerWord: "回来",
    userReport: "这是一段足够长、能够参与偏好判断的训练汇报。",
    durationActual: 120,
    completedAt: `${date}T12:00:00.000Z`,
    interrupted: false,
    statDelta: { ...EMPTY_STATS, obedience: 2, conditioning: 1 },
    reward: { type: "praise", delaySeconds: 3, text: "收下。" },
    ownerVerdict: "乖，今天收下。",
    source: "mock",
    ...overrides
  };
}

test("check-in counts unique completed days and carries streak from yesterday", () => {
  const today = "2026-07-17";
  const records = [
    record("2026-07-14"),
    record("2026-07-15"),
    record("2026-07-16"),
    record("2026-07-16"),
    record("2026-07-17", { interrupted: true })
  ];
  assert.deepEqual(calculateCheckIn(records, today), {
    currentStreak: 3,
    longestStreak: 3,
    totalDays: 3
  });
});

test("history summary captures interruptions, repeated task types and stat growth", () => {
  const today = "2026-07-17";
  const records = [
    record(shiftDate(today, -2)),
    record(shiftDate(today, -1), { type: "posture", interrupted: true, statDelta: { ...EMPTY_STATS, resistance: 1 } }),
    record(today, { userReport: "很长".repeat(50), triggerWord: "归位" })
  ];
  const summary = summarizeRecentHistory(records, today);
  assert.equal(summary.recordCount, 3);
  assert.equal(summary.interruptedCount, 1);
  assert.equal(summary.completedTypes.find((item) => item.type === "hiddenTimer")?.count, 2);
  assert.equal(summary.statGrowth.obedience, 4);
  assert.deepEqual(summary.triggerWords.sort(), ["回来", "归位"].sort());
});

test("dynamic mock obeys task switches, intensity cap and strict schema", () => {
  const { apiKey: _apiKey, ...settings } = {
    ...DEFAULT_SETTINGS,
    allowEdging: false,
    allowPosture: false,
    allowConfession: false,
    allowRepeat: false,
    allowHiddenTimer: false,
    maxIntensity: 2
  };
  const context: TaskGenerationContext = {
    profileConfig: {
      ...DEFAULT_PROFILE,
      intensityDefault: 5,
      preferredTaskTypes: ["edging", "posture", "confession", "repeat"],
      forbiddenTaskTypes: ["mixed", "reward", "aftercare"]
    },
    personaProfile: {
      modeId: "intimate",
      modeName: "Intimate",
      summary: "<char> is steady and direct."
    },
    collarPurpose: COLLAR_PURPOSE,
    trainingGoal: "形成稳定等待与汇报习惯。",
    punishmentGoal: "未完成时补做原任务缺失部分。",
    selectedMode: "breakdown",
    modePreference: DEFAULT_TRAINING_CONFIG.modePreferences.breakdown,
    messageToOwner: "今天很兴奋，想重一点。",
    terminalCapabilities: {
      maxTimerSeconds: settings.hiddenTimerMaxSeconds,
      updateIntervalMinutes: 15,
      soundEnabled: true,
      vibrationEnabled: true,
      timerHidden: false,
      fixedTimerEnabled: false,
      trainingDayStart: "08:00"
    },
    isTest: true,
    settings: { ...settings, apiKeyConfigured: false },
    today: "2026-07-17",
    currentStats: { ...EMPTY_STATS, resistance: 8 },
    checkIn: { currentStreak: 2, longestStreak: 5, totalDays: 9 },
    recentHistorySummary: summarizeRecentHistory([], "2026-07-17"),
    pendingPunishmentSummary: { count: 0, oldestAge: -1, titles: [] },
    yesterdayResult: null,
    todayState: "很兴奋，想重一点",
    desiredModes: ["Ruined"]
  };
  const task = TrainingTaskSchema.parse(generateMockTask(context));
  assert.equal(task.type, "thinking");
  assert.equal(task.intensity, 2);
  assert.equal(task.timer.enabled, false);
  assert.match(task.ownerResponse, /今天很兴奋/);
});

test("Collar dates use UTC+8 across the UTC day boundary", () => {
  assert.equal(localDateKey(new Date("2026-07-17T15:59:59.000Z")), "2026-07-17");
  assert.equal(localDateKey(new Date("2026-07-17T16:00:00.000Z")), "2026-07-18");
});

test("timer maximum is a hard cap even when the configured minimum is higher", () => {
  assert.deepEqual(resolveTimerBounds(
    { enabled: true, minSeconds: 900, maxSeconds: 1800 },
    { hiddenTimerMinSeconds: 1200, hiddenTimerMaxSeconds: 600 }
  ), {
    minSeconds: 600,
    maxSeconds: 600
  });
});

test("fixed timer uses the configured maximum as an exact duration", () => {
  assert.deepEqual(resolveTimerBounds(
    { enabled: true, minSeconds: 60, maxSeconds: 240 },
    {
      hiddenTimerMinSeconds: 30,
      hiddenTimerMaxSeconds: 900,
      fixedTimerEnabled: true
    }
  ), {
    minSeconds: 900,
    maxSeconds: 900
  });
});

test("hidden timers run without exposing a countdown", () => {
  assert.equal(resolveTimerVisibility({ enabled: true, hidden: true }), "hidden");
  assert.equal(resolveTimerVisibility({ enabled: true, hidden: false }), "visible");
  assert.equal(resolveTimerVisibility({ enabled: false, hidden: true }), "none");
});

test("profile accepts content restriction identifiers in forbiddenTaskTypes", () => {
  const profile = ProfileConfigSchema.parse({
    ...DEFAULT_PROFILE,
    forbiddenTaskTypes: ["publicExposure", "thirdPartyInvolvement", "medicalRisk"]
  });
  assert.deepEqual(profile.forbiddenTaskTypes, ["publicExposure", "thirdPartyInvolvement", "medicalRisk"]);
});

test("legacy local state receives the new long-term training configuration", () => {
  const current = defaultCollarState();
  const { trainingConfig: _trainingConfig, ...legacy } = current;
  const migrated = parseCollarState({ ...legacy, version: 1 }, current);
  assert.equal(migrated.version, 3);
  assert.deepEqual(migrated.trainingConfig, DEFAULT_TRAINING_CONFIG);
});

test("legacy two-field state preferences merge into one readable text block", () => {
  const migrated = CollarTrainingConfigSchema.parse({
    personaModeId: "intimate",
    trainingGoal: "长期方向",
    modePreferences: {
      gentle: { preferred: "轻声命令", refused: "不要长时间等待" },
      daily: { preferred: "稳定汇报", refused: "" },
      breakdown: { preferred: "严格验收", refused: "拒绝公开任务" }
    }
  });
  assert.match(migrated.modePreferences.gentle.content, /轻声命令/);
  assert.match(migrated.modePreferences.gentle.content, /不要长时间等待/);
});

test("four-block AI JSON maps Shape Your Pet and Pet Today fields", () => {
  const parsed = CollarFourBlockImportSchema.parse({
    shapeYourPet: {
      training: "长期塑造方向",
      punish: "未通过时如何补做"
    },
    petToday: {
      gentle: "Gentle 文本",
      routine: "Routine 文本",
      ruined: "Ruined 文本"
    }
  });
  assert.equal(parsed.shapeYourPet.training, "长期塑造方向");
  assert.equal(parsed.shapeYourPet.punish, "未通过时如何补做");
  assert.equal(parsed.petToday.routine, "Routine 文本");
});

test("legacy four-block JSON keeps its Shape Your Pet text as Training", () => {
  const parsed = CollarFourBlockImportSchema.parse({
    shapeYourPet: "旧版长期塑造方向",
    petToday: {
      gentle: "Gentle 文本",
      routine: "Routine 文本",
      ruined: "Ruined 文本"
    }
  });
  assert.equal(parsed.shapeYourPet.training, "旧版长期塑造方向");
  assert.equal(parsed.shapeYourPet.punish, "");
});

test("four-block import repairs smart quotes and normalizes spaced field names", () => {
  const repaired = parseStrictJson(`【
  {
    “shape Your Pet”: {
      “training”: “长期训练”,
      “punishment”: “纠正规则”,
    },
    “pet today”: {
      “gentle”: “轻柔状态”,
      “daily”: “日常状态”,
      “breakdown”: “极端状态”,
    },
  }
  】`);
  const parsed = CollarFourBlockImportSchema.parse(repaired);
  assert.equal(parsed.shapeYourPet.training, "长期训练");
  assert.equal(parsed.shapeYourPet.punish, "纠正规则");
  assert.equal(parsed.petToday.routine, "日常状态");
  assert.equal(parsed.petToday.ruined, "极端状态");
});

test("training day rolls over at the configured UTC+8 morning time", () => {
  assert.equal(trainingDayKey(new Date("2026-07-17T23:59:00.000Z"), "08:00"), "2026-07-17");
  assert.equal(trainingDayKey(new Date("2026-07-18T00:00:00.000Z"), "08:00"), "2026-07-18");
  assert.equal(trainingDayKey(new Date("2026-07-18T03:29:00.000Z"), "11:30"), "2026-07-17");
  assert.equal(trainingDayKey(new Date("2026-07-18T03:30:00.000Z"), "11:30"), "2026-07-18");
});

test("first accepted training resets to wear collar at the next morning boundary", () => {
  const yesterday = record("2026-07-17", { interrupted: true });
  assert.equal(hasAcceptedTrainingOnDay([yesterday], null, "2026-07-17"), true);
  assert.equal(hasAcceptedTrainingOnDay([yesterday], null, "2026-07-18"), false);
  assert.equal(hasAcceptedTrainingOnDay([
    record("2026-07-18", { isPunishment: true })
  ], null, "2026-07-18"), false);
  assert.equal(hasAcceptedTrainingOnDay([
    record("2026-07-18", { correctionKind: "makeup" })
  ], null, "2026-07-18"), false);
});

test("punishment debt reminds at D+0 night, persists at D+1 and blocks at D+2", () => {
  const correction = {
    title: "补交汇报",
    reason: "关键步骤没有完成。",
    intensity: 2,
    openingCommand: "重做缺失的步骤。",
    steps: [{ label: "补做", instruction: "完成原来遗漏的步骤。", requiresUserAction: true }],
    timer: {
      enabled: false,
      hidden: false,
      minSeconds: 0,
      maxSeconds: 0,
      displayTextWhileWaiting: "",
      endText: "回来。"
    },
    report: { required: true, prompt: "交代补做结果。", minLength: 20 },
    completionText: "等待重新验收。"
  };
  const verdict = TrainingVerdictSchema.parse({
    status: "punishment",
    ownerVerdict: "没有达到要求，补交。",
    makeup: correction,
    punishment: { ...correction, title: "独立惩罚" }
  });
  const debt = createPunishmentDebt({
    verdict,
    sourceTaskId: "source-task",
    assignedTrainingDay: "2026-07-17",
    assignedAt: "2026-07-17T10:00:00.000Z",
    source: "mock"
  });

  const d0Night = punishmentPolicy([debt], "2026-07-17", new Date("2026-07-17T14:00:00.000Z"));
  assert.equal(d0Night.remindTonight, true);
  assert.equal(d0Night.blocksTraining, false);
  assert.equal(debt.makeupStatus, "pending");
  assert.equal(debt.punishmentStatus, "pending");
  assert.equal(punishmentPolicy([debt], "2026-07-18").persistent, true);
  assert.equal(punishmentPolicy([debt], "2026-07-19").blocksTraining, true);
});

test("failed and punishment records do not count as a completed check-in day", () => {
  const today = "2026-07-17";
  assert.deepEqual(calculateCheckIn([
    record(today, { verdictStatus: "punishment", punishmentId: "debt-1" }),
    record(today, { isPunishment: true, verdictStatus: "passed" }),
    record(today, { correctionKind: "makeup", verdictStatus: "passed" })
  ], today), {
    currentStreak: 0,
    longestStreak: 0,
    totalDays: 0
  });
});

test("local failed verdict creates exact makeup and a separate Punishment task", async () => {
  const task = TrainingTaskSchema.parse({
    taskId: "failed-verdict-task",
    date: "2026-07-17",
    title: "原来的等待任务",
    type: "hiddenTimer",
    intensity: 3,
    triggerWord: "回来",
    ownerResponse: "",
    openingCommand: "完成原来的等待。",
    description: "原任务。",
    steps: [{ label: "等待", instruction: "等待提示。", requiresUserAction: true }],
    timer: {
      enabled: true,
      hidden: true,
      minSeconds: 60,
      maxSeconds: 120,
      displayTextWhileWaiting: "等待。",
      endText: "回来。"
    },
    report: { required: true, prompt: "汇报。", minLength: 20 },
    completionText: "等待验收。",
    statDelta: { ...EMPTY_STATS, obedience: 1 },
    reward: { type: "praise", delaySeconds: 0, text: "收下。" },
    safety: { requiresPrivateSpace: true, allowsEmergencyExit: true, notes: "" }
  });
  const verdict = await generateVerdict({
    settings: { ...DEFAULT_SETTINGS, aiMode: "mock" },
    profile: DEFAULT_PROFILE,
    task,
    report: "我没有完成，直接跳过了。",
    interrupted: false,
    recentRecords: [],
    punishmentGoal: "惩罚使用口头重复：选定一句纠正规则，慢慢重复七遍，再汇报哪一遍开始听懂。"
  });

  assert.equal(verdict.status, "punishment");
  assert.match(verdict.makeup?.title || "", /补齐/);
  assert.match(verdict.makeup?.steps[0]?.instruction || "", /仅在这一项刚才没有完成时补做/);
  assert.match(verdict.punishment?.reason || "", /口头重复/);
  assert.match(verdict.punishment?.title || "", /说|规矩/);
  assert.doesNotMatch(verdict.punishment?.title || "", /补交/);
  assert.doesNotMatch(verdict.punishment?.openingCommand || "", /重做原任务/);
});

test("punishment can be retried once and then converts to points", async () => {
  const task = TrainingTaskSchema.parse({
    taskId: "punishment-retry",
    date: "2026-07-17",
    title: "独立惩罚",
    type: "mixed",
    intensity: 4,
    triggerWord: "偿还",
    ownerResponse: "",
    openingCommand: "完成惩罚。",
    description: "独立惩罚。",
    steps: [{ label: "执行", instruction: "完成惩罚要求。", requiresUserAction: true }],
    timer: {
      enabled: false,
      hidden: false,
      minSeconds: 0,
      maxSeconds: 0,
      displayTextWhileWaiting: "",
      endText: "回来。"
    },
    report: { required: true, prompt: "汇报惩罚。", minLength: 20 },
    completionText: "等待验收。",
    statDelta: { ...EMPTY_STATS, obedience: 1, badCat: -1 },
    reward: { type: "aftercare", delaySeconds: 0, text: "收下。" },
    safety: { requiresPrivateSpace: true, allowsEmergencyExit: true, notes: "" }
  });
  const input = {
    settings: { ...DEFAULT_SETTINGS, aiMode: "mock" as const },
    profile: DEFAULT_PROFILE,
    task,
    report: "我没有完成这条惩罚。",
    interrupted: false,
    recentRecords: [],
    punishmentGoal: "口头重复七遍。",
    correctionKind: "punishment" as const
  };

  const first = await generateVerdict({ ...input, correctionAttempt: 1 });
  assert.equal(first.status, "punishment");
  assert.ok(first.punishment);
  const second = await generateVerdict({ ...input, correctionAttempt: 2 });
  assert.equal(second.status, "punishment");
  assert.equal(second.punishment, null);
  assert.match(second.ownerVerdict, /坏猫值/);
});

test("saved AI mode remains user controlled", () => {
  const imported = parseCollarState({
    ...defaultCollarState(),
    settings: {
      ...DEFAULT_SETTINGS,
      aiMode: "mock"
    }
  });

  assert.equal(imported.settings.aiMode, "mock");
});
