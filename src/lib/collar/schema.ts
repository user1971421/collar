import { z } from "zod";

export const TASK_TYPES = [
  "thinking",
  "posture",
  "hiddenTimer",
  "edging",
  "confession",
  "repeat",
  "reward",
  "aftercare",
  "mixed"
] as const;

export const TaskTypeSchema = z.enum(TASK_TYPES);
export type TaskType = z.infer<typeof TaskTypeSchema>;

export const TRAINING_MODES = ["gentle", "daily", "breakdown"] as const;
export const TrainingModeSchema = z.enum(TRAINING_MODES);
export type TrainingMode = z.infer<typeof TrainingModeSchema>;

export const COLLAR_PURPOSE = "Collar 是一个由 <char> 下发私人训练、等待执行、接收汇报、亲自验收并连续归档的终端。任务不是普通待办；开始前要回应 <user> 写给 <char> 的话，随后给出完整指令，必要时调用终端计时，最后要求回来汇报。";

const ModePreferenceSchema = z.preprocess((raw) => {
  if (!raw || typeof raw !== "object") return raw;
  const value = raw as { content?: unknown; preferred?: unknown; refused?: unknown };
  if (typeof value.content === "string") return { content: value.content };
  const preferred = String(value.preferred || "").trim();
  const refused = String(value.refused || "").trim();
  return {
    content: [
      preferred ? `希望出现：\n${preferred}` : "",
      refused ? `拒绝出现：\n${refused}` : ""
    ].filter(Boolean).join("\n\n")
  };
}, z.object({
  content: z.string().max(8000)
}).strict());

export const CollarTrainingConfigSchema = z.object({
  personaModeId: z.string().max(120),
  trainingGoal: z.string().max(12000),
  punishmentGoal: z.string().max(12000).default(""),
  modePreferences: z.object({
    gentle: ModePreferenceSchema,
    daily: ModePreferenceSchema,
    breakdown: ModePreferenceSchema
  }).strict()
}).strict();

export type CollarTrainingConfig = z.infer<typeof CollarTrainingConfigSchema>;

const ShapeYourPetImportSchema = z.union([
  z.string().max(12000).transform((training) => ({ training, punish: "" })),
  z.object({
    training: z.string().max(12000),
    punish: z.string().max(12000)
  }).strict()
]);

const CollarFourBlockCanonicalSchema = z.object({
  shapeYourPet: ShapeYourPetImportSchema,
  petToday: z.object({
    gentle: z.string().max(8000),
    routine: z.string().max(8000),
    ruined: z.string().max(8000)
  }).strict()
}).strict();

function compactImportKey(value: string) {
  return value.toLowerCase().replace(/[\s_-]+/g, "");
}

function importField(source: unknown, ...names: string[]) {
  if (!source || typeof source !== "object" || Array.isArray(source)) return undefined;
  const entries = Object.entries(source as Record<string, unknown>);
  const keys = new Set(names.map(compactImportKey));
  return entries.find(([key]) => keys.has(compactImportKey(key)))?.[1];
}

export const CollarFourBlockImportSchema = z.preprocess((raw) => {
  const shape = importField(raw, "shapeYourPet", "shape your pet");
  const today = importField(raw, "petToday", "pet today");
  if (shape === undefined || today === undefined) return raw;
  const training = importField(shape, "training", "train");
  const punish = importField(shape, "punish", "punishment");
  const gentle = importField(today, "gentle");
  const routine = importField(today, "routine", "daily");
  const ruined = importField(today, "ruined", "breakdown");
  if (
    typeof shape !== "string"
    && (training === undefined || punish === undefined)
  ) return raw;
  if (gentle === undefined || routine === undefined || ruined === undefined) return raw;
  const normalizedShape = typeof shape === "string"
    ? shape
    : {
      training,
      punish
    };
  return {
    shapeYourPet: normalizedShape,
    petToday: {
      gentle,
      routine,
      ruined
    }
  };
}, CollarFourBlockCanonicalSchema);

export type CollarFourBlockImport = z.infer<typeof CollarFourBlockImportSchema>;

export const TrainingRequestSnapshotSchema = z.object({
  personaModeId: z.string().max(120),
  personaModeName: z.string().max(200),
  selectedMode: TrainingModeSchema,
  messageToOwner: z.string().max(1200),
  trainingGoal: z.string().max(12000),
  punishmentGoal: z.string().max(12000).default(""),
  modePreference: ModePreferenceSchema,
  isTest: z.boolean()
}).strict();

export type TrainingRequestSnapshot = z.infer<typeof TrainingRequestSnapshotSchema>;

export const STAT_KEYS = [
  "belonging",
  "obedience",
  "dependency",
  "resistance",
  "conditioning",
  "badCat"
] as const;

export const StatDeltaSchema = z.object({
  belonging: z.number().int().min(-20).max(20),
  obedience: z.number().int().min(-20).max(20),
  dependency: z.number().int().min(-20).max(20),
  resistance: z.number().int().min(-20).max(20),
  conditioning: z.number().int().min(-20).max(20),
  badCat: z.number().int().min(-20).max(20)
}).strict();

export type CollarStats = z.infer<typeof StatDeltaSchema>;

export const TaskStepSchema = z.object({
  label: z.string().min(1).max(60),
  instruction: z.string().min(1).max(800),
  requiresUserAction: z.boolean()
}).strict();

export const TrainingTaskSchema = z.object({
  taskId: z.string().min(1).max(120),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  title: z.string().min(1).max(80),
  type: TaskTypeSchema,
  intensity: z.number().int().min(1).max(5),
  triggerWord: z.string().min(1).max(40),
  ownerResponse: z.string().max(800).default(""),
  openingCommand: z.string().min(1).max(500),
  description: z.string().min(1).max(1600),
  steps: z.array(TaskStepSchema).min(1).max(10),
  timer: z.object({
    enabled: z.boolean(),
    hidden: z.boolean(),
    minSeconds: z.number().int().min(0).max(7200),
    maxSeconds: z.number().int().min(0).max(7200),
    displayTextWhileWaiting: z.string().max(500),
    endText: z.string().max(500)
  }).strict(),
  report: z.object({
    required: z.boolean(),
    prompt: z.string().max(800),
    minLength: z.number().int().min(0).max(2000)
  }).strict(),
  completionText: z.string().min(1).max(800),
  statDelta: StatDeltaSchema,
  reward: z.object({
    type: z.enum(["praise", "permission", "extraTask", "aftercare"]),
    delaySeconds: z.number().int().min(0).max(60),
    text: z.string().min(1).max(800)
  }).strict(),
  safety: z.object({
    requiresPrivateSpace: z.boolean(),
    allowsEmergencyExit: z.boolean(),
    notes: z.string().max(500)
  }).strict()
}).strict();

export type TrainingTask = z.infer<typeof TrainingTaskSchema>;

export const PunishmentAssignmentSchema = z.object({
  title: z.string().min(1).max(80),
  reason: z.string().min(1).max(500),
  intensity: z.number().int().min(1).max(5),
  openingCommand: z.string().min(1).max(500),
  steps: z.array(TaskStepSchema).min(1).max(6),
  timer: z.object({
    enabled: z.boolean(),
    hidden: z.boolean(),
    minSeconds: z.number().int().min(0).max(7200),
    maxSeconds: z.number().int().min(0).max(7200),
    displayTextWhileWaiting: z.string().max(500),
    endText: z.string().max(500)
  }).strict(),
  report: z.object({
    required: z.boolean(),
    prompt: z.string().max(800),
    minLength: z.number().int().min(0).max(2000)
  }).strict(),
  completionText: z.string().min(1).max(800)
}).strict();

export type PunishmentAssignment = z.infer<typeof PunishmentAssignmentSchema>;

export const TrainingVerdictSchema = z.object({
  status: z.enum(["passed", "punishment"]),
  ownerVerdict: z.string().min(1).max(800),
  makeup: PunishmentAssignmentSchema.nullable(),
  punishment: PunishmentAssignmentSchema.nullable()
}).strict().superRefine((value, context) => {
  if (value.status === "passed" && (value.makeup !== null || value.punishment !== null)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["makeup"], message: "passed verdict cannot include corrections" });
  }
});

export type TrainingVerdict = z.infer<typeof TrainingVerdictSchema>;

export const PunishmentDebtSchema = z.object({
  id: z.string().min(1).max(160),
  sourceTaskId: z.string().min(1).max(120),
  assignedTrainingDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  assignedAt: z.string().datetime(),
  status: z.enum(["pending", "completed", "converted"]),
  makeup: PunishmentAssignmentSchema.nullable().default(null),
  makeupStatus: z.enum(["pending", "completed"]).default("completed"),
  assignment: PunishmentAssignmentSchema,
  punishmentStatus: z.enum(["pending", "completed", "converted"]).default("pending"),
  source: z.enum(["mock", "user-key", "backend-proxy", "fallback"]),
  failureCount: z.number().int().min(0).max(999).default(0),
  pointPenalty: z.number().int().min(0).max(999).default(0),
  completedAt: z.string().datetime().optional(),
  completionReport: z.string().max(6000).optional(),
  completionVerdict: z.string().max(800).optional()
}).strict();

export type PunishmentDebt = z.infer<typeof PunishmentDebtSchema>;

export const ProfileConfigSchema = z.object({
  ownerName: z.string().min(1).max(80),
  petName: z.string().min(1).max(80),
  relationshipType: z.string().max(300),
  tone: z.string().max(500),
  kinkTags: z.array(z.string().max(80)).max(40),
  hardLimits: z.array(z.string().max(160)).max(40),
  softLimits: z.array(z.string().max(160)).max(40),
  preferredTaskTypes: z.array(z.string().min(1).max(80)).max(40),
  forbiddenTaskTypes: z.array(z.string().min(1).max(80)).max(40),
  aftercareStyle: z.string().max(500),
  language: z.string().min(1).max(80),
  explicitnessLevel: z.number().int().min(1).max(5),
  intensityDefault: z.number().int().min(1).max(5)
}).strict();

export type ProfileConfig = z.infer<typeof ProfileConfigSchema>;

export const CollarSettingsSchema = z.object({
  aiMode: z.enum(["mock", "user-key", "backend-proxy"]),
  baseURL: z.string().max(500),
  apiKey: z.string().max(1000),
  model: z.string().max(200),
  temperature: z.number().min(0).max(2),
  maxTokens: z.number().int().min(128).max(16000),
  maxIntensity: z.number().int().min(1).max(5),
  allowExplicit: z.boolean(),
  allowEdging: z.boolean(),
  allowPosture: z.boolean(),
  allowConfession: z.boolean(),
  allowRepeat: z.boolean(),
  allowHiddenTimer: z.boolean(),
  hiddenTimerMinSeconds: z.number().int().min(10).max(7200),
  hiddenTimerMaxSeconds: z.number().int().min(10).max(7200),
  soundEnabled: z.boolean(),
  vibrationEnabled: z.boolean(),
  aiVerdictEnabled: z.boolean(),
  fixedTimerEnabled: z.boolean().default(false),
  trainingDayStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default("08:00")
}).strict();

export type CollarSettings = z.infer<typeof CollarSettingsSchema>;

export const PollingConfigSchema = z.object({
  enabled: z.boolean(),
  autoGenerateDaily: z.boolean(),
  intervalMinutes: z.number().int().min(1).max(1440),
  activeHourStart: z.number().int().min(0).max(23),
  activeHourEnd: z.number().int().min(0).max(23),
  defaultDailyState: z.string().max(500),
  defaultDesiredModes: z.array(z.enum(["温柔", "严格", "羞耻", "色情", "安抚", "加训"])).max(6)
}).strict();

export type PollingConfig = z.infer<typeof PollingConfigSchema>;

export type TaskRuntime = {
  task: TrainingTask;
  generatedAt: string;
  source: "mock" | "user-key" | "backend-proxy" | "fallback";
  sourceNote?: string;
  status: "issued" | "executing" | "reporting";
  startedAt?: string;
  timerDurationSeconds?: number;
  timerEndsAt?: string;
  requestSnapshot?: TrainingRequestSnapshot;
  punishmentId?: string;
  correctionKind?: "makeup" | "punishment";
};

export type TrainingRecord = {
  date: string;
  taskId: string;
  title: string;
  type: TaskType;
  intensity: number;
  triggerWord: string;
  userReport: string;
  durationActual: number;
  completedAt: string;
  interrupted: boolean;
  statDelta: CollarStats;
  reward: TrainingTask["reward"];
  ownerVerdict: string;
  ownerOpeningResponse?: string;
  source: TaskRuntime["source"];
  requestSnapshot?: TrainingRequestSnapshot;
  verdictStatus?: "passed" | "punishment";
  punishmentId?: string;
  isPunishment?: boolean;
  correctionKind?: "makeup" | "punishment";
};

export type CollarState = {
  version: 3;
  profile: ProfileConfig;
  trainingConfig: CollarTrainingConfig;
  settings: CollarSettings;
  polling: PollingConfig;
  stats: CollarStats;
  activeTask: TaskRuntime | null;
  records: TrainingRecord[];
  punishments: PunishmentDebt[];
  lastDailyState: string;
  lastDesiredModes: string[];
  lastPollAt: string;
};

export type TaskGenerationContext = {
  profileConfig: ProfileConfig;
  personaProfile: {
    modeId: string;
    modeName: string;
    summary: string;
  };
  collarPurpose: string;
  trainingGoal: string;
  punishmentGoal: string;
  selectedMode: TrainingMode;
  modePreference: CollarTrainingConfig["modePreferences"][TrainingMode];
  messageToOwner: string;
  terminalCapabilities: {
    maxTimerSeconds: number;
    updateIntervalMinutes: number;
    soundEnabled: boolean;
    vibrationEnabled: boolean;
    timerHidden: boolean;
    fixedTimerEnabled: boolean;
    trainingDayStart: string;
  };
  isTest: boolean;
  settings: Omit<CollarSettings, "apiKey"> & { apiKeyConfigured: boolean };
  today: string;
  currentStats: CollarStats;
  checkIn: {
    currentStreak: number;
    longestStreak: number;
    totalDays: number;
  };
  recentHistorySummary: ReturnType<typeof import("./history").summarizeRecentHistory>;
  pendingPunishmentSummary: {
    count: number;
    oldestAge: number;
    titles: string[];
  };
  yesterdayResult: TrainingRecord | null;
  todayState: string;
  desiredModes: string[];
};

export const EMPTY_STATS: CollarStats = {
  belonging: 0,
  obedience: 0,
  dependency: 0,
  resistance: 0,
  conditioning: 0,
  badCat: 0
};

export const DEFAULT_PROFILE: ProfileConfig = {
  ownerName: "<char>",
  petName: "<user>",
  relationshipType: "",
  tone: "",
  kinkTags: [],
  hardLimits: [],
  softLimits: [],
  preferredTaskTypes: [],
  forbiddenTaskTypes: [],
  aftercareStyle: "",
  language: "简体中文",
  explicitnessLevel: 1,
  intensityDefault: 1
};

export const DEFAULT_TRAINING_CONFIG: CollarTrainingConfig = {
  personaModeId: "",
  trainingGoal: "",
  punishmentGoal: "",
  modePreferences: {
    gentle: { content: "" },
    daily: { content: "" },
    breakdown: { content: "" }
  }
};

export const DEFAULT_SETTINGS: CollarSettings = {
  aiMode: "mock",
  baseURL: "",
  apiKey: "",
  model: "",
  temperature: 0.9,
  maxTokens: 1800,
  maxIntensity: 4,
  allowExplicit: true,
  allowEdging: true,
  allowPosture: true,
  allowConfession: true,
  allowRepeat: true,
  allowHiddenTimer: true,
  hiddenTimerMinSeconds: 60,
  hiddenTimerMaxSeconds: 600,
  soundEnabled: true,
  vibrationEnabled: true,
  aiVerdictEnabled: true,
  fixedTimerEnabled: false,
  trainingDayStart: "08:00"
};

export const DEFAULT_POLLING: PollingConfig = {
  enabled: false,
  autoGenerateDaily: false,
  intervalMinutes: 15,
  activeHourStart: 7,
  activeHourEnd: 23,
  defaultDailyState: "",
  defaultDesiredModes: []
};
