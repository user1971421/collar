"use client";

import {
  ChangeEvent,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { generateTask, generateVerdict } from "@/lib/collar/ai-client";
import {
  createPunishmentDebt,
  hasAcceptedTrainingOnDay,
  makeupTask,
  MAX_PUNISHMENT_ATTEMPTS,
  nextCorrectionKind,
  punishmentAge,
  punishmentPointPenalty,
  punishmentPolicy,
  punishmentTask,
  trainingDayKey
} from "@/lib/collar/discipline";
import {
  applyStatDelta,
  calculateCheckIn,
  localDateKey,
  summarizeRecentHistory,
  yesterdayRecord
} from "@/lib/collar/history";
import {
  COLLAR_PURPOSE,
  CollarFourBlockImportSchema,
  DEFAULT_POLLING,
  DEFAULT_PROFILE,
  DEFAULT_SETTINGS,
  DEFAULT_TRAINING_CONFIG,
  EMPTY_STATS,
  ProfileConfigSchema,
  STAT_KEYS,
  type CollarState,
  type CollarStats,
  type CollarTrainingConfig,
  type PunishmentDebt,
  type TaskGenerationContext,
  type TaskRuntime,
  type TaskType,
  type TrainingMode,
  type TrainingRecord
} from "@/lib/collar/schema";
import {
  defaultCollarState,
  exportableState,
  loadCollarState,
  parseCollarState,
  saveCollarState
} from "@/lib/collar/storage";
import { parseStrictJson, resolveTimerBounds, resolveTimerVisibility } from "@/lib/collar/validation";

type Surface = "terminal" | "archive" | "settings";
type IssuanceStep = "closed" | "mode" | "message";
type ConnectionPanel = "profile" | "api";
type TapResponse = {
  id: number;
  pawX: number;
  pawY: number;
  bubbleX: number;
  bubbleY: number;
  message: string;
  side: "left" | "right";
};
const TRAINING_MODE_META: Record<TrainingMode, { label: string; caption: string }> = {
  gentle: { label: "Gentle", caption: "轻一点，但仍然交给他决定" },
  daily: { label: "Routine", caption: "稳定、持续，按档案继续训练" },
  breakdown: { label: "Ruined", caption: "更严格、更深入，不许敷衍" }
};

const FOUR_BLOCK_GENERATOR_PROMPT = `请根据已有的 Profile、关系设定、成人偏好、长期目标和既有互动记录，为 Collar 整理一份长期使用的模式偏好配置。

这份配置用于帮助后续 AI 理解双方的关系重点，并在不同模式下选择合适的身体内容、情色偏好、任务方向、语气和互动方式。请主动提炼反复出现、情绪浓度高、能够代表双方独特关系的内容，并允许沿着既有偏好进行合理发散。

每部分使用简洁、具体、可组合的自然语言，不生成完整任务。

请整理以下固定标题：

[RELATIONSHIP CORE]

整理所有模式共同继承的关系基础，包括双方身份、权力结构、主导方式、占有与照看、互动距离和整体语言气质。

[TRAINING · PREFER]

整理长期希望建立的服从习惯、身体训练方向、欲望表达、服务意识、主动性、汇报方式、关系仪式和成长目标。

[TRAINING · AVOID]

整理会让长期训练失去关系感、连续性或身体感的方向。

[PUNISH · PREFER]

整理任务未完成、敷衍或偏离规则时，双方偏好的纠正、返工、补偿、重新验收和惩罚体验。

[PUNISH · AVOID]

整理不符合双方关系意义，或会让惩罚显得随机、无关和失去掌控感的方向。

[GENTLE · PREFER]

整理宠物疲惫、发软、承受力较低或需要被照看时，仍然喜欢保留的主导感、轻度身体互动、情色内容、语气和奖励。

[GENTLE · AVOID]

整理不适合 Gentle 状态的体验方向。

[ROUTINE · PREFER]

整理正常承受状态下适合日常轮换的身体刺激、姿势、展示、等待、欲望控制、服务、汇报、讨赏、验收和奖励方向。

[ROUTINE · AVOID]

整理会让日常训练变得重复、空泛、无聊或脱离双方关系的方向。

[RUINED · PREFER]

整理最高强度状态中真正符合用户偏好的身体控制、刺激、羞耻、恐惧、疼痛氛围、失控感、非人幻想、毁坏幻想、意识或身体变化，以及主导者的推进方式。

[RUINED · AVOID]

整理会让 Ruined 退化成普通高强度任务、纯猎奇内容或失去情色与关系核心的方向。

每个部分写成一小段或数条简短内容，优先保留最有代表性的重点。默认所有参与者均为明确成年，所有现实互动均自愿、私密且可停止，极端内容属于虚构幻想。

把上述内容装入下方既有 JSON 结构。映射必须严格遵守：

- shapeYourPet.training：依次包含 [RELATIONSHIP CORE]、[TRAINING · PREFER]、[TRAINING · AVOID]。
- shapeYourPet.punish：依次包含 [PUNISH · PREFER]、[PUNISH · AVOID]。
- petToday.gentle：依次包含 [GENTLE · PREFER]、[GENTLE · AVOID]。
- petToday.routine：依次包含 [ROUTINE · PREFER]、[ROUTINE · AVOID]。
- petToday.ruined：依次包含 [RUINED · PREFER]、[RUINED · AVOID]。

每个字段必须是一个 JSON 字符串，保留对应的方括号标题，并在同一字符串内部使用正确转义的换行。不要增加字段，不要改名，不要输出 null、数组或嵌套的偏好对象。

最终只输出严格 JSON，不要 Markdown，不要代码围栏，不要附加说明。JSON 中所有双引号、换行和特殊字符必须正确转义。

输出结构：

{
  "shapeYourPet": {
    "training": "[RELATIONSHIP CORE]\\n...\\n\\n[TRAINING · PREFER]\\n...\\n\\n[TRAINING · AVOID]\\n...",
    "punish": "[PUNISH · PREFER]\\n...\\n\\n[PUNISH · AVOID]\\n..."
  },
  "petToday": {
    "gentle": "[GENTLE · PREFER]\\n...\\n\\n[GENTLE · AVOID]\\n...",
    "routine": "[ROUTINE · PREFER]\\n...\\n\\n[ROUTINE · AVOID]\\n...",
    "ruined": "[RUINED · PREFER]\\n...\\n\\n[RUINED · AVOID]\\n..."
  }
}`;

const STAT_LABELS: Record<keyof CollarStats, string> = {
  belonging: "归属值",
  obedience: "顺从值",
  dependency: "依赖值",
  resistance: "反抗值",
  conditioning: "暗示深度",
  badCat: "坏猫值"
};
const TYPE_LABELS: Record<TaskType, string> = {
  thinking: "幻想 / 思考",
  posture: "姿态等待",
  hiddenTimer: "隐藏倒计时",
  edging: "寸止",
  confession: "羞耻承认",
  repeat: "口头重复",
  reward: "讨赏",
  aftercare: "安抚归位",
  mixed: "组合训练"
};
const SOURCE_LABELS: Record<TaskRuntime["source"], string> = {
  mock: "本地模拟下发",
  "user-key": "用户 API 下发",
  "backend-proxy": "服务器代理下发",
  fallback: "AI 异常 · 已回退"
};

const OWNER_TAP_RESPONSES: Record<TrainingMode, ((petName: string) => string)[]> = {
  gentle: [
    (petName) => `碰到了。${petName}乖乖等着，我在。`,
    () => "别急，我没有把你落下。",
    () => "手收好。剩下的时间让我替你数。",
    () => "可以想我，但还不许离开这条命令。"
  ],
  daily: [
    () => "又来碰屏幕。记下了，继续。",
    () => "还没响。回到命令里去。",
    () => "我看见了。现在把手放回原位。",
    () => "想催我？今天的等待由我决定。"
  ],
  breakdown: [
    () => "碰一下，也不会让命令提前结束。",
    () => "还在试探。很好，这一笔我也收下。",
    () => "屏幕会回应你，但时间只听我的。",
    () => "不许用触碰换答案。继续等。"
  ]
};

function formatTerminalDate(dateKey: string) {
  const [year, month, day] = dateKey.split("-");
  return `${month}-${day}-${year}`;
}

function formatUtc8Time(date: Date) {
  const utc8 = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return [utc8.getUTCHours(), utc8.getUTCMinutes(), utc8.getUTCSeconds()]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

function formatUtc8Timestamp(value: string) {
  const date = new Date(value);
  return `${formatTerminalDate(localDateKey(date))} ${formatUtc8Time(date)}`;
}

function formatDuration(seconds: number) {
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes} 分 ${rest} 秒` : `${minutes} 分钟`;
}

function randomDuration(min: number, max: number) {
  return Math.floor(Math.random() * (Math.max(min, max) - min + 1)) + min;
}

function audioConstructor() {
  return window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
}

function playEndSignal(sound: boolean, vibration: boolean, prepared?: AudioContext | null) {
  if (vibration && "vibrate" in navigator) navigator.vibrate([180, 100, 260]);
  if (!sound) return;
  try {
    const AudioCtor = audioConstructor();
    const context = prepared?.state !== "closed" ? prepared : AudioCtor ? new AudioCtor() : null;
    if (!context) return;
    void context.resume();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(620, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(880, context.currentTime + 0.35);
    gain.gain.setValueAtTime(0.001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.16, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.7);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.72);
  } catch (error) {
    console.warn("[collar] end signal unavailable", error);
  }
}

function CollapsibleTextEditor({
  title,
  value,
  maxLength,
  placeholder,
  onChange
}: {
  title: string;
  value: string;
  maxLength: number;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  const preview = value.trim().replace(/\s+/g, " ").slice(0, 96);
  return (
    <details className="collar-block-editor">
      <summary>
        <strong>{title}</strong>
        <span>{preview || "尚未填写"}</span>
      </summary>
      <textarea
        value={value}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </details>
  );
}

function Toggle({
  checked,
  label,
  onChange
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="collar-toggle-row">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

export function CollarTerminal() {
  const [state, setState] = useState<CollarState>(() => defaultCollarState());
  const [hydrated, setHydrated] = useState(false);
  const [surface, setSurface] = useState<Surface>("terminal");
  const [terminalNow, setTerminalNow] = useState(() => new Date());
  const [issuanceStep, setIssuanceStep] = useState<IssuanceStep>("closed");
  const [selectedTrainingMode, setSelectedTrainingMode] = useState<TrainingMode>("daily");
  const [messageToOwner, setMessageToOwner] = useState("");
  const [connectionPanel, setConnectionPanel] = useState<ConnectionPanel>("profile");
  const [profileJson, setProfileJson] = useState(() => JSON.stringify(DEFAULT_PROFILE, null, 2));
  const [profileStatus, setProfileStatus] = useState("");
  const [fourBlockJson, setFourBlockJson] = useState("");
  const [fourBlockStatus, setFourBlockStatus] = useState("");
  const [generating, setGenerating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [generationStatus, setGenerationStatus] = useState("");
  const [report, setReport] = useState("");
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [tapResponses, setTapResponses] = useState<TapResponse[]>([]);
  const [verdictRecord, setVerdictRecord] = useState<TrainingRecord | null>(null);
  const [rewardWait, setRewardWait] = useState(0);
  const importRef = useRef<HTMLInputElement>(null);
  const generatingRef = useRef(false);
  const endedTaskRef = useRef("");
  const audioContextRef = useRef<AudioContext | null>(null);
  const tapSequenceRef = useRef(0);
  const tapTimeoutsRef = useRef<number[]>([]);

  const calendarToday = localDateKey(terminalNow);
  const today = trainingDayKey(terminalNow, state.settings.trainingDayStart);
  const checkIn = useMemo(() => calculateCheckIn(state.records, today), [state.records, today]);
  const active = state.activeTask;
  const personaProfileSummary = useMemo(() => JSON.stringify(state.profile, null, 2), [state.profile]);
  const acceptedTrainingToday = hasAcceptedTrainingOnDay(state.records, active, today);
  const discipline = useMemo(
    () => punishmentPolicy(state.punishments, today, terminalNow),
    [state.punishments, terminalNow, today]
  );

  useEffect(() => {
    const loaded = loadCollarState();
    const loadedTrainingDay = trainingDayKey(new Date(), loaded.settings.trainingDayStart);
    if (loaded.activeTask && !loaded.activeTask.punishmentId && loaded.activeTask.task.date !== loadedTrainingDay) {
      const stale = loaded.activeTask;
      const delta = { ...EMPTY_STATS, resistance: 1 };
      loaded.records.push({
        date: stale.task.date,
        taskId: stale.task.taskId,
        title: stale.task.title,
        type: stale.task.type,
        intensity: stale.task.intensity,
        triggerWord: stale.task.triggerWord,
        userReport: "",
        durationActual: stale.startedAt
          ? Math.max(0, Math.round((Date.now() - new Date(stale.startedAt).getTime()) / 1000))
          : 0,
        completedAt: new Date().toISOString(),
        interrupted: true,
        statDelta: delta,
        reward: { ...stale.task.reward, text: "跨日未归档，命令已收回。" },
        ownerVerdict: "这条命令没有在当天交回来。跨日记录已经收下，今天重新开始。",
        ownerOpeningResponse: stale.task.ownerResponse,
        source: stale.source,
        requestSnapshot: stale.requestSnapshot
      });
      loaded.stats = applyStatDelta(loaded.stats, delta);
      loaded.activeTask = null;
    }
    setState(loaded);
    setProfileJson(JSON.stringify(loaded.profile, null, 2));
    setHydrated(true);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setTerminalNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => () => {
    tapTimeoutsRef.current.forEach((timeout) => window.clearTimeout(timeout));
  }, []);

  useEffect(() => {
    if (hydrated) saveCollarState(state);
  }, [hydrated, state]);

  useEffect(() => {
    if (hydrated) setProfileJson(JSON.stringify(state.profile, null, 2));
  }, [hydrated, state.profile]);

  const patchTrainingConfig = useCallback((patch: Partial<CollarTrainingConfig>) => {
    setState((previous) => ({
      ...previous,
      trainingConfig: { ...previous.trainingConfig, ...patch }
    }));
  }, []);

  const patchModePreference = useCallback((
    mode: TrainingMode,
    patch: Partial<CollarTrainingConfig["modePreferences"][TrainingMode]>
  ) => {
    setState((previous) => ({
      ...previous,
      trainingConfig: {
        ...previous.trainingConfig,
        modePreferences: {
          ...previous.trainingConfig.modePreferences,
          [mode]: {
            ...previous.trainingConfig.modePreferences[mode],
            ...patch
          }
        }
      }
    }));
  }, []);

  const buildContext = useCallback((
    mode: TrainingMode,
    ownerMessage: string
  ): TaskGenerationContext => {
    const { apiKey: _apiKey, ...publicSettings } = state.settings;
    return {
      profileConfig: state.profile,
      personaProfile: {
        modeId: "local-profile",
        modeName: state.profile.ownerName || "<char>",
        summary: personaProfileSummary
      },
      collarPurpose: COLLAR_PURPOSE,
      trainingGoal: state.trainingConfig.trainingGoal,
      punishmentGoal: state.trainingConfig.punishmentGoal,
      selectedMode: mode,
      modePreference: state.trainingConfig.modePreferences[mode],
      messageToOwner: ownerMessage,
      terminalCapabilities: {
        maxTimerSeconds: state.settings.hiddenTimerMaxSeconds,
        updateIntervalMinutes: state.polling.intervalMinutes,
        soundEnabled: state.settings.soundEnabled,
        vibrationEnabled: state.settings.vibrationEnabled,
        timerHidden: state.settings.allowHiddenTimer,
        fixedTimerEnabled: state.settings.fixedTimerEnabled,
        trainingDayStart: state.settings.trainingDayStart
      },
      isTest: false,
      settings: { ...publicSettings, apiKeyConfigured: Boolean(state.settings.apiKey) },
      today,
      currentStats: state.stats,
      checkIn: calculateCheckIn(state.records),
      recentHistorySummary: summarizeRecentHistory(state.records),
      pendingPunishmentSummary: {
        count: discipline.pending.length,
        oldestAge: discipline.oldestAge,
        titles: discipline.pending.map((punishment) => punishment.assignment.title).slice(0, 8)
      },
      yesterdayResult: yesterdayRecord(state.records),
      todayState: ownerMessage,
      desiredModes: [TRAINING_MODE_META[mode].label]
    };
  }, [discipline.oldestAge, discipline.pending, personaProfileSummary, state, today]);

  const issueTask = useCallback(async (options?: {
    mode?: TrainingMode;
    ownerMessage?: string;
    replace?: boolean;
    automatic?: boolean;
  }) => {
    if (generatingRef.current) return;
    if (discipline.blocksTraining) {
      setGenerationStatus("到期惩罚未偿还，今天的新项圈暂不激活");
      setIssuanceStep("closed");
      return;
    }
    const selectedMode = options?.mode || "daily";
    const ownerMessage = (options?.ownerMessage || "").trim();
    if (state.activeTask && !options?.replace) {
      setGenerationStatus("已有一条未归档命令");
      return;
    }
    generatingRef.current = true;
    setGenerating(true);
    setGenerationStatus(options?.automatic ? "轮询命中，正在下发…" : "<char> 正在读取档案…");
    try {
      const context = buildContext(selectedMode, ownerMessage);
      const result = await generateTask(context, state.settings);
      const requestSnapshot = {
        personaModeId: context.personaProfile.modeId,
        personaModeName: context.personaProfile.modeName,
        selectedMode,
        messageToOwner: ownerMessage,
        trainingGoal: context.trainingGoal,
        punishmentGoal: context.punishmentGoal,
        modePreference: context.modePreference,
        isTest: false
      };
      setState((previous) => ({
        ...previous,
        activeTask: {
          task: result.task,
          generatedAt: new Date().toISOString(),
          source: result.source,
          sourceNote: result.note,
          status: "issued",
          requestSnapshot
        },
        lastDailyState: ownerMessage,
        lastDesiredModes: [selectedMode],
        lastPollAt: options?.automatic ? new Date().toISOString() : previous.lastPollAt
      }));
      setGenerationStatus(result.source === "fallback"
        ? `AI 下发失败，已使用备用任务：${result.note || "返回不合法"}`
        : SOURCE_LABELS[result.source]);
      setIssuanceStep("closed");
      setMessageToOwner("");
      setSurface("terminal");
    } finally {
      generatingRef.current = false;
      setGenerating(false);
    }
  }, [
    buildContext,
    discipline.blocksTraining,
    state.activeTask,
    state.settings
  ]);

  useEffect(() => {
    if (!active || active.status !== "executing" || !active.task.timer.enabled || !active.timerEndsAt) return;
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((new Date(active.timerEndsAt!).getTime() - Date.now()) / 1000));
      setRemainingSeconds(remaining);
      if (remaining === 0 && endedTaskRef.current !== active.task.taskId) {
        endedTaskRef.current = active.task.taskId;
        playEndSignal(state.settings.soundEnabled, state.settings.vibrationEnabled, audioContextRef.current);
        setState((previous) => previous.activeTask
          ? { ...previous, activeTask: { ...previous.activeTask, status: "reporting" } }
          : previous);
      }
    };
    tick();
    const timer = window.setInterval(tick, 500);
    return () => window.clearInterval(timer);
  }, [active, state.settings.soundEnabled, state.settings.vibrationEnabled]);

  useEffect(() => {
    if (!active || active.status !== "executing" || !("wakeLock" in navigator)) return;
    let sentinel: { release: () => Promise<void>; released?: boolean } | null = null;
    let cancelled = false;
    const acquire = async () => {
      if (document.visibilityState !== "visible" || sentinel && !sentinel.released) return;
      try {
        const lock = await (navigator as Navigator & {
          wakeLock: { request: (type: "screen") => Promise<{ release: () => Promise<void>; released?: boolean }> };
        }).wakeLock.request("screen");
        if (cancelled) await lock.release();
        else sentinel = lock;
      } catch {
        // Wake Lock support is best-effort; timer recovery uses persisted end time.
      }
    };
    const onVisibility = () => void acquire();
    void acquire();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      if (sentinel && !sentinel.released) void sentinel.release();
    };
  }, [active]);

  useEffect(() => {
    if (!verdictRecord) return;
    if (verdictRecord.verdictStatus === "punishment") {
      setRewardWait(0);
      return;
    }
    const unlockAt = new Date(verdictRecord.completedAt).getTime() + verdictRecord.reward.delaySeconds * 1000;
    const tick = () => setRewardWait(Math.max(0, Math.ceil((unlockAt - Date.now()) / 1000)));
    tick();
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [verdictRecord]);

  async function copyFourBlockPrompt() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(FOUR_BLOCK_GENERATOR_PROMPT);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = FOUR_BLOCK_GENERATOR_PROMPT;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        textarea.remove();
      }
      setFourBlockStatus("生成 Prompt 已复制");
    } catch {
      setFourBlockStatus("复制失败，请检查浏览器剪贴板权限");
    }
  }

  function applyFourBlockJson() {
    try {
      const parsed = CollarFourBlockImportSchema.parse(parseStrictJson(fourBlockJson));
      setState((previous) => ({
        ...previous,
        trainingConfig: {
          ...previous.trainingConfig,
          trainingGoal: parsed.shapeYourPet.training,
          punishmentGoal: parsed.shapeYourPet.punish,
          modePreferences: {
            gentle: { content: parsed.petToday.gentle },
            daily: { content: parsed.petToday.routine },
            breakdown: { content: parsed.petToday.ruined }
          }
        }
      }));
      setFourBlockStatus("Training、Punishment 与三种 Pet Today 文本已分配");
    } catch (error) {
      setFourBlockStatus(error instanceof Error ? error.message : "无法识别这份 JSON");
    }
  }

  function applyProfileJson() {
    try {
      const profile = ProfileConfigSchema.parse(parseStrictJson(profileJson));
      setState((previous) => ({ ...previous, profile }));
      setProfileJson(JSON.stringify(profile, null, 2));
      setProfileStatus("Profile 已写入本机");
    } catch (error) {
      setProfileStatus(error instanceof Error ? error.message : "无法识别 Profile JSON");
    }
  }

  function beginIssuance() {
    if (discipline.blocksTraining && discipline.pending[0]) {
      beginPunishment(discipline.pending[0]);
      return;
    }
    setSelectedTrainingMode("daily");
    setMessageToOwner("");
    setGenerationStatus("");
    setIssuanceStep("mode");
  }

  function chooseTrainingMode(mode: TrainingMode) {
    setSelectedTrainingMode(mode);
    setIssuanceStep("message");
  }

  function generateSelectedTask() {
    void issueTask({
      mode: selectedTrainingMode,
      ownerMessage: messageToOwner,
      replace: Boolean(active)
    });
  }

  function beginPunishment(debt: PunishmentDebt) {
    if (active) {
      setGenerationStatus("先完成当前命令，再处理惩罚欠账");
      return;
    }
    const correctionKind = nextCorrectionKind(debt);
    setState((previous) => ({
      ...previous,
      activeTask: {
        task: correctionKind === "makeup"
          ? makeupTask(debt, today, previous.settings)
          : punishmentTask(debt, today, previous.settings),
        generatedAt: debt.assignedAt,
        source: debt.source,
        status: "issued",
        punishmentId: debt.id,
        correctionKind,
        requestSnapshot: {
          personaModeId: "local-profile",
          personaModeName: previous.profile.ownerName || "<char>",
          selectedMode: "daily",
          messageToOwner: "",
          trainingGoal: previous.trainingConfig.trainingGoal,
          punishmentGoal: previous.trainingConfig.punishmentGoal,
          modePreference: previous.trainingConfig.modePreferences.daily,
          isTest: false
        }
      }
    }));
    setIssuanceStep("closed");
    setSurface("terminal");
    setGenerationStatus(correctionKind === "makeup"
      ? "原任务缺失项已调出。补齐后再执行独立惩罚。"
      : `惩罚已调出。${debt.failureCount ? "这是唯一一次补交机会。" : "完成并重新交给主人验收。"}`);
  }

  async function startTask() {
    if (!active) return;
    const task = active.task;
    const bounds = resolveTimerBounds(task.timer, state.settings);
    const duration = task.timer.enabled
      ? randomDuration(bounds.minSeconds, bounds.maxSeconds)
      : 0;
    const now = new Date();
    if (state.settings.soundEnabled) {
      const AudioCtor = audioConstructor();
      if (AudioCtor && (!audioContextRef.current || audioContextRef.current.state === "closed")) {
        audioContextRef.current = new AudioCtor();
      }
      void audioContextRef.current?.resume();
    }
    endedTaskRef.current = "";
    setReport("");
    setState((previous) => previous.activeTask ? {
      ...previous,
      activeTask: {
        ...previous.activeTask,
        task: previous.activeTask.punishmentId
          ? { ...previous.activeTask.task, date: today }
          : previous.activeTask.task,
        status: "executing",
        startedAt: now.toISOString(),
        timerDurationSeconds: duration,
        timerEndsAt: task.timer.enabled ? new Date(now.getTime() + duration * 1000).toISOString() : undefined
      }
    } : previous);
    try {
      await document.documentElement.requestFullscreen?.();
    } catch {
      // The fixed execution layer still provides the full-screen task mode.
    }
  }

  function finishUntimedTask() {
    setState((previous) => previous.activeTask
      ? { ...previous, activeTask: { ...previous.activeTask, status: "reporting" } }
      : previous);
  }

  function handleExecutionTap(event: ReactMouseEvent<HTMLElement>) {
    if (!active || active.status !== "executing" || !active.task.timer.enabled) return;
    if (
      event.target instanceof Element
      && event.target.closest("button, a, input, textarea, select, label")
    ) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const rawX = event.clientX - rect.left;
    const rawY = event.clientY - rect.top;
    const visibility = resolveTimerVisibility(active.task.timer);
    const safeTop = visibility === "visible" ? 212 : 184;
    const pawX = Math.max(20, Math.min(rect.width - 20, rawX));
    const pawY = Math.max(safeTop, Math.min(rect.height - 28, rawY));
    const bubbleWidth = Math.min(216, rect.width - 24);
    const side = pawX < rect.width / 2 ? "right" : "left";
    const bubbleX = side === "right"
      ? Math.min(rect.width - bubbleWidth - 12, pawX + 16)
      : Math.max(12, pawX - bubbleWidth - 16);
    const bubbleY = Math.max(
      safeTop,
      Math.min(rect.height - 142, pawY - 94)
    );
    const sequence = tapSequenceRef.current++;
    const mode = active.requestSnapshot?.selectedMode || "daily";
    const responsePool = OWNER_TAP_RESPONSES[mode];
    const id = Date.now() + sequence;
    const response: TapResponse = {
      id,
      pawX,
      pawY,
      bubbleX,
      bubbleY,
      message: responsePool[sequence % responsePool.length](state.profile.petName),
      side
    };

    setTapResponses((previous) => [...previous.slice(-2), response]);
    if (state.settings.vibrationEnabled && "vibrate" in navigator) navigator.vibrate(18);
    const timeout = window.setTimeout(() => {
      setTapResponses((previous) => previous.filter((item) => item.id !== id));
      tapTimeoutsRef.current = tapTimeoutsRef.current.filter((item) => item !== timeout);
    }, 2300);
    tapTimeoutsRef.current.push(timeout);
  }

  function durationActual(runtime: TaskRuntime) {
    if (!runtime.startedAt) return 0;
    return Math.max(0, Math.round((Date.now() - new Date(runtime.startedAt).getTime()) / 1000));
  }

  async function emergencyExit() {
    if (!active) return;
    const delta = { ...EMPTY_STATS, resistance: 1 };
    const record: TrainingRecord = {
      date: active.task.date,
      taskId: active.task.taskId,
      title: active.task.title,
      type: active.task.type,
      intensity: active.task.intensity,
      triggerWord: active.task.triggerWord,
      userReport: "",
      durationActual: durationActual(active),
      completedAt: new Date().toISOString(),
      interrupted: true,
      statDelta: delta,
      reward: { ...active.task.reward, text: "本次训练已停止。状态收好，档案保留。" },
      ownerVerdict: `${state.profile.ownerName}记下了这次退出。停下不等于失败，先把状态收好。`,
      ownerOpeningResponse: active.task.ownerResponse,
      source: active.source,
      requestSnapshot: active.requestSnapshot,
      verdictStatus: active.punishmentId ? "punishment" : undefined,
      punishmentId: active.punishmentId,
      isPunishment: active.correctionKind === "punishment",
      correctionKind: active.correctionKind
    };
    setState((previous) => ({
      ...previous,
      activeTask: null,
      stats: applyStatDelta(previous.stats, delta),
      records: [...previous.records, record]
    }));
    setVerdictRecord(record);
    setReport("");
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
  }

  async function submitReport() {
    if (!active || submitting) return;
    if (active.task.report.required && report.trim().length < active.task.report.minLength) return;
    setSubmitting(true);
    try {
      const currentDebt = active.punishmentId
        ? state.punishments.find((punishment) => punishment.id === active.punishmentId)
        : undefined;
      const correctionAttempt = active.correctionKind === "punishment"
        ? (currentDebt?.failureCount || 0) + 1
        : 0;
      const verdict = await generateVerdict({
        settings: state.settings,
        profile: state.profile,
        personaProfile: personaProfileSummary,
        requestSnapshot: active.requestSnapshot,
        task: active.task,
        report: report.trim(),
        interrupted: false,
        recentRecords: state.records,
        punishmentGoal: state.trainingConfig.punishmentGoal,
        correctionKind: active.correctionKind,
        correctionAttempt,
        pendingPunishments: state.punishments
      });
      const failed = verdict.status === "punishment";
      const punishmentRetryExhausted = active.correctionKind === "punishment"
        && failed
        && correctionAttempt >= MAX_PUNISHMENT_ATTEMPTS;
      const newDebt = !active.punishmentId && failed
        ? createPunishmentDebt({
          verdict,
          sourceTaskId: active.task.taskId,
          assignedTrainingDay: active.task.date,
          source: active.source
        })
        : null;
      const punishmentId = active.punishmentId || newDebt?.id;
      const appliedDelta = !active.correctionKind
        ? failed
          ? { ...EMPTY_STATS, resistance: 1, badCat: 1 }
          : active.task.statDelta
        : active.correctionKind === "makeup"
          ? failed
            ? { ...EMPTY_STATS }
            : active.task.statDelta
          : failed
            ? punishmentRetryExhausted && currentDebt
              ? {
                ...EMPTY_STATS,
                resistance: 1,
                badCat: punishmentPointPenalty(currentDebt)
              }
              : { ...EMPTY_STATS }
            : active.task.statDelta;
      const record: TrainingRecord = {
        date: active.task.date,
        taskId: active.task.taskId,
        title: active.task.title,
        type: active.task.type,
        intensity: active.task.intensity,
        triggerWord: active.task.triggerWord,
        userReport: report.trim(),
        durationActual: durationActual(active),
        completedAt: new Date().toISOString(),
        interrupted: false,
        statDelta: appliedDelta,
        reward: failed
          ? {
            ...active.task.reward,
            delaySeconds: 0,
            text: punishmentRetryExhausted
              ? `惩罚补交次数已用完，坏猫值 +${currentDebt ? punishmentPointPenalty(currentDebt) : 1}。`
              : active.correctionKind === "punishment"
                ? "惩罚未通过。只剩一次补交机会。"
                : active.correctionKind === "makeup"
                  ? "缺失项仍未补齐，继续保留在欠账中。"
                  : "原任务缺失项必须补齐，独立惩罚也已记入欠账。"
          }
          : active.task.reward,
        ownerVerdict: verdict.ownerVerdict,
        ownerOpeningResponse: active.task.ownerResponse,
        source: active.source,
        requestSnapshot: active.requestSnapshot,
        verdictStatus: verdict.status,
        punishmentId,
        isPunishment: active.correctionKind === "punishment",
        correctionKind: active.correctionKind
      };
      setState((previous) => ({
        ...previous,
        activeTask: null,
        stats: applyStatDelta(previous.stats, appliedDelta),
        records: [...previous.records, record],
        punishments: active.punishmentId
          ? previous.punishments.map((punishment) => {
            if (punishment.id !== active.punishmentId) return punishment;
            if (active.correctionKind === "makeup") {
              return failed
                ? {
                  ...punishment,
                  makeup: verdict.makeup || punishment.makeup
                }
                : {
                  ...punishment,
                  makeupStatus: "completed" as const
                };
            }
            if (!failed) {
              return {
                ...punishment,
                status: "completed" as const,
                punishmentStatus: "completed" as const,
                completedAt: record.completedAt,
                completionReport: report.trim(),
                completionVerdict: verdict.ownerVerdict
              };
            }
            if (punishmentRetryExhausted) {
              return {
                ...punishment,
                status: "converted" as const,
                punishmentStatus: "converted" as const,
                failureCount: punishment.failureCount + 1,
                pointPenalty: punishmentPointPenalty(punishment),
                completedAt: record.completedAt,
                completionReport: report.trim(),
                completionVerdict: verdict.ownerVerdict
              };
            }
            return {
              ...punishment,
              assignment: verdict.punishment || punishment.assignment,
              failureCount: punishment.failureCount + 1
            };
          })
          : newDebt
            ? [...previous.punishments, newDebt]
            : previous.punishments
      }));
      setVerdictRecord(record);
      setReport("");
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
    } finally {
      setSubmitting(false);
    }
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(exportableState(state), null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `collar-${localDateKey()}-archive.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  async function importJson(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const imported = parseCollarState(JSON.parse(await file.text()), state);
      if (!imported.settings.apiKey && state.settings.apiKey) {
        imported.settings.apiKey = state.settings.apiKey;
      }
      setState(imported);
      setGenerationStatus("JSON 已导入");
    } catch (error) {
      setGenerationStatus(error instanceof Error ? error.message : "导入失败");
    } finally {
      event.target.value = "";
    }
  }

  function clearAll() {
    if (!window.confirm("清空 Collar 的 profile、设置、任务、数值和全部归档？此操作不可撤回。")) return;
    const next = defaultCollarState();
    setState(next);
    setGenerationStatus("全部数据已清空");
  }

  if (!hydrated) {
    return <main className="collar-app collar-loading">正在开启 Collar 档案…</main>;
  }

  const execution = active && (active.status === "executing" || active.status === "reporting")
    ? active
    : null;
  const executionTimerVisibility = execution
    ? resolveTimerVisibility(execution.task.timer)
    : "none";
  const verdictDebt = verdictRecord?.punishmentId
    ? state.punishments.find((punishment) => punishment.id === verdictRecord.punishmentId)
    : null;

  return (
    <main className="collar-app">
      <header className="collar-header">
        <div>
          <span className="collar-kicker">◆ PRIVATE TRAINING TERMINAL</span>
          <h1>COLLAR</h1>
        </div>
        <span>&lt;char&gt; / &lt;user&gt;</span>
      </header>

      {surface === "terminal" ? (
        <>
          <section className="collar-status-band">
            <div className="collar-date">
              <div className="collar-timecode">
                <span>UTC+8</span>
                <strong>{formatUtc8Time(terminalNow)}</strong>
                <time>{formatTerminalDate(calendarToday)}</time>
              </div>
              <strong>
                <i aria-hidden />
                {active
                  ? active.correctionKind === "makeup"
                    ? "补交执行中"
                    : active.correctionKind === "punishment"
                      ? "惩罚执行中"
                      : "命令已下发"
                  : discipline.blocksTraining
                    ? "训练已锁定"
                    : acceptedTrainingToday ? "等待摇铃" : "等待下发"}
              </strong>
            </div>
            <div className="collar-checkin">
              <div><strong>{String(checkIn.currentStreak).padStart(2, "0")}</strong><span>连续归档</span></div>
              <div><strong>{String(checkIn.totalDays).padStart(2, "0")}</strong><span>累计打卡</span></div>
              <div><strong>{String(checkIn.longestStreak).padStart(2, "0")}</strong><span>最长连续</span></div>
            </div>
          </section>

          <section className="collar-stats">
            {STAT_KEYS.map((key) => (
              <div key={key}>
                <span>{STAT_LABELS[key]}</span>
                <strong>{String(state.stats[key]).padStart(2, "0")}</strong>
                <i style={{ width: `${Math.min(100, state.stats[key])}%` }} />
              </div>
            ))}
          </section>

          {!active && discipline.pending.length ? (
            <section className={`collar-punishment-queue ${discipline.blocksTraining ? "is-blocking" : discipline.remindTonight || discipline.persistent ? "is-warning" : ""}`}>
              <div className="collar-punishment-heading">
                <div>
                  <span>PUNISHMENT DEBT</span>
                  <strong>{discipline.pending.length} 笔未偿还</strong>
                </div>
                <em>D+{discipline.oldestAge}</em>
              </div>
              <p>
                {discipline.blocksTraining
                  ? "欠账已到 D+2。今天的新项圈暂不激活，先主动完成至少一笔到期惩罚。"
                  : discipline.persistent
                    ? "惩罚已经进入 D+1，将持续留在终端首页，直到主动偿还。"
                    : discipline.remindTonight
                      ? "已经过了 22:00。今天判下的惩罚还没有完成。"
                      : "主人已经留下惩罚。现在可以主动偿还，也可以暂时收进欠账。"}
              </p>
              <div className="collar-punishment-list">
                {discipline.pending.map((punishment) => {
                  const correctionKind = nextCorrectionKind(punishment);
                  const assignment = correctionKind === "makeup"
                    ? punishment.makeup || punishment.assignment
                    : punishment.assignment;
                  return (
                    <article key={punishment.id}>
                      <div>
                        <small>
                          D+{punishmentAge(punishment, today)}
                          {" · "}
                          {correctionKind === "makeup"
                            ? "先补原任务"
                            : punishment.failureCount
                              ? "惩罚最后一次补交"
                              : "独立惩罚"}
                        </small>
                        <strong>{assignment.title}</strong>
                        <span>{assignment.reason}</span>
                      </div>
                      <button type="button" onClick={() => beginPunishment(punishment)}>
                        {correctionKind === "makeup" ? "补齐缺失项" : punishment.failureCount ? "最后一次补交" : "执行惩罚"}
                      </button>
                    </article>
                  );
                })}
              </div>
            </section>
          ) : null}

          <section className={`collar-task-stage ${active && issuanceStep === "closed" ? "has-task" : "is-idle"}`}>
            {issuanceStep === "mode" ? (
              <section className="collar-issuance collar-issuance-flow">
                <div className="collar-flow-heading">
                  <span>PET TODAY</span>
                  <h2>今天想被怎样对待？</h2>
                </div>
                <div className="collar-training-modes">
                  {(Object.keys(TRAINING_MODE_META) as TrainingMode[]).map((mode) => (
                    <button type="button" key={mode} onClick={() => chooseTrainingMode(mode)}>
                      <strong>{TRAINING_MODE_META[mode].label}</strong>
                      <span>{TRAINING_MODE_META[mode].caption}</span>
                    </button>
                  ))}
                </div>
                <button className="collar-text-button" type="button" onClick={() => setIssuanceStep("closed")}>返回</button>
              </section>
            ) : issuanceStep === "message" ? (
              <section className="collar-issuance collar-issuance-flow">
                <div className="collar-flow-heading">
                  <span>{TRAINING_MODE_META[selectedTrainingMode].label}</span>
                  <h2>写一句给主人</h2>
                </div>
                <textarea
                  autoFocus
                  value={messageToOwner}
                  maxLength={1200}
                  onChange={(event) => setMessageToOwner(event.target.value)}
                  placeholder="现在最想让 <char> 知道什么…"
                />
                <button
                  className="collar-primary collar-wear-button"
                  type="button"
                  disabled={generating || !messageToOwner.trim()}
                  onClick={generateSelectedTask}
                >
                  {generating ? "<char> 正在读取…" : "交给 <char>"}
                </button>
                <button className="collar-text-button" type="button" onClick={() => setIssuanceStep("mode")}>重新选择模式</button>
                {generationStatus ? <p className="collar-generation-status">{generationStatus}</p> : null}
              </section>
            ) : active ? (
              <section className="collar-task-sheet">
                <div className="collar-sheet-meta">
                  <span>
                    {active.punishmentId
                      ? active.correctionKind === "makeup" ? "MAKEUP" : "PUNISHMENT"
                      : active.requestSnapshot ? TRAINING_MODE_META[active.requestSnapshot.selectedMode].label : TYPE_LABELS[active.task.type]}
                    {" · "}强度 {active.task.intensity}
                  </span>
                  <span>{SOURCE_LABELS[active.source]}</span>
                </div>
                {active.task.ownerResponse ? (
                  <blockquote className="collar-owner-response">{active.task.ownerResponse}</blockquote>
                ) : null}
                <div className="collar-trigger">
                  <span>今日触发词</span>
                  <strong>{active.task.triggerWord}</strong>
                </div>
                <h2>{active.task.title}</h2>
                <p className="collar-command">{active.task.openingCommand}</p>
                <p className="collar-description">{active.task.description}</p>
                <ol className="collar-steps">
                  {active.task.steps.map((step, index) => (
                    <li key={`${step.label}-${index}`}>
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <div><strong>{step.label}</strong><p>{step.instruction}</p></div>
                    </li>
                  ))}
                </ol>
                <div className="collar-task-foot">
                  <span>
                    {active.task.timer.enabled
                      ? state.settings.fixedTimerEnabled
                        ? `固定计时${active.task.timer.hidden ? " · 隐藏" : ""}`
                        : active.task.timer.hidden ? "隐藏计时" : "计时任务"
                      : "无计时"}
                  </span>
                  <span>汇报不少于 {active.task.report.minLength} 字</span>
                </div>
                <button className="collar-primary" type="button" onClick={() => void startTask()}>
                  {active.correctionKind === "makeup"
                    ? "开始补交"
                    : active.correctionKind === "punishment"
                      ? active.punishmentId && state.punishments.find((item) => item.id === active.punishmentId)?.failureCount
                        ? "开始最后一次补交"
                        : "开始惩罚"
                      : "开始执行"}
                </button>
                {active.sourceNote ? <p className="collar-source-note">{active.sourceNote}</p> : null}
              </section>
            ) : (
              <section className="collar-issuance">
                <div className="collar-standby">
                  <strong>&gt; STANDBY</strong>
                  <p>
                    {discipline.blocksTraining
                      ? "新的训练日暂时锁住。先把到期的惩罚主动交清，再回来戴上项圈。"
                      : acceptedTrainingToday
                        ? "这个训练日已经接受过命令。想要的话，可以摇铃再来一条。"
                        : `项圈待命中。每天 ${state.settings.trainingDayStart} 起算新的训练日。`}
                    <i aria-hidden>▊</i>
                  </p>
                </div>
                <div className="collar-pulse" aria-hidden />
                <button
                  className="collar-primary collar-wear-button"
                  type="button"
                  disabled={generating}
                  onClick={beginIssuance}
                >
                  [ {discipline.blocksTraining ? "先偿还惩罚" : acceptedTrainingToday ? "摇摇铃铛" : "戴上项圈"} ]
                </button>
                {generationStatus ? <p className="collar-generation-status">{generationStatus}</p> : null}
              </section>
            )}
          </section>
        </>
      ) : null}

      {surface === "archive" ? (
        <section className="collar-archive">
          <div className="collar-section-title"><strong>训练档案</strong><span>{state.records.length} RECORDS</span></div>
          {!state.records.length ? <p className="collar-empty">还没有归档记录。</p> : null}
          {[...state.records].reverse().map((record) => {
            const punishment = record.punishmentId
              ? state.punishments.find((item) => item.id === record.punishmentId)
              : null;
            const unresolved = record.verdictStatus === "punishment" && punishment?.status === "pending";
            const converted = punishment?.status === "converted";
            const status = record.interrupted
              ? "中断"
              : converted && record.correctionKind === "punishment"
                ? "已计点"
              : unresolved
                ? "未完"
                : record.correctionKind || punishment?.status === "completed"
                  ? "已偿还"
                  : "验收";
            return (
              <details key={`${record.taskId}-${record.completedAt}`}>
                <summary>
                  <span>{formatTerminalDate(record.date)}</span>
                  <strong>{record.title}</strong>
                  <em className={record.interrupted ? "interrupted" : unresolved || converted ? "unresolved" : record.correctionKind ? "repaid" : ""}>
                    {status}
                  </em>
                </summary>
                <div className="collar-record-body">
                  {record.requestSnapshot ? (
                    <p className="collar-record-context">
                      {TRAINING_MODE_META[record.requestSnapshot.selectedMode].label}
                      {record.requestSnapshot.messageToOwner ? ` · “${record.requestSnapshot.messageToOwner}”` : ""}
                    </p>
                  ) : record.correctionKind ? (
                    <p className="collar-record-context">
                      {record.correctionKind === "makeup" ? "ORIGINAL TASK MAKEUP" : "PUNISHMENT DEBT"}
                    </p>
                  ) : null}
                  {record.ownerOpeningResponse ? <blockquote>{record.ownerOpeningResponse}</blockquote> : null}
                  <p className="verdict">{record.ownerVerdict}</p>
                  <dl>
                    <div>
                      <dt>类型</dt>
                      <dd>
                        {record.correctionKind === "makeup"
                          ? "缺失项补交"
                          : record.correctionKind === "punishment"
                            ? "惩罚偿还"
                            : TYPE_LABELS[record.type]}
                      </dd>
                    </div>
                    <div><dt>强度</dt><dd>{record.intensity}</dd></div>
                    <div><dt>触发词</dt><dd>{record.triggerWord}</dd></div>
                    <div><dt>实际时长</dt><dd>{formatDuration(record.durationActual)}</dd></div>
                  </dl>
                  {unresolved && punishment ? (
                    <div className="collar-record-debt">
                      <strong>{punishment.makeupStatus === "pending" ? "原任务待补交" : "惩罚待完成"}</strong>
                      <p>
                        {punishment.makeupStatus === "pending"
                          ? punishment.makeup?.title || punishment.assignment.title
                          : punishment.assignment.title}
                      </p>
                    </div>
                  ) : null}
                  {converted ? (
                    <div className="collar-record-debt">
                      <strong>惩罚补交次数用尽</strong>
                      <p>坏猫值 +{punishment?.pointPenalty || 0}，欠账已关闭。</p>
                    </div>
                  ) : null}
                  {record.userReport ? <blockquote>{record.userReport}</blockquote> : null}
                  <div className="collar-deltas">
                    {STAT_KEYS.filter((key) => record.statDelta[key] !== 0).map((key) => (
                      <span key={key}>{STAT_LABELS[key]} {record.statDelta[key] > 0 ? "+" : ""}{record.statDelta[key]}</span>
                    ))}
                  </div>
                </div>
              </details>
            );
          })}
        </section>
      ) : null}

      {surface === "settings" ? (
        <section className="collar-settings">
          <div className="collar-section-title"><strong>Generate Four Blocks</strong><span>AI JSON</span></div>
          <div className="collar-four-block-import">
            <button className="collar-secondary" type="button" onClick={() => void copyFourBlockPrompt()}>
              复制 AI 生成 Prompt
            </button>
            <textarea
              value={fourBlockJson}
              onChange={(event) => setFourBlockJson(event.target.value)}
              placeholder="把 AI 返回的 JSON 粘贴到这里…"
              spellCheck={false}
            />
            <button className="collar-secondary" type="button" disabled={!fourBlockJson.trim()} onClick={applyFourBlockJson}>
              识别并分配核心设定
            </button>
            {fourBlockStatus ? <p>{fourBlockStatus}</p> : null}
          </div>

          <div className="collar-section-title collar-settings-divider"><strong>Shape Your Pet</strong><span>LONG TERM</span></div>
          <div className="collar-shape-grid">
            <CollapsibleTextEditor
              title="Training"
              value={state.trainingConfig.trainingGoal}
              maxLength={12000}
              onChange={(trainingGoal) => patchTrainingConfig({ trainingGoal })}
              placeholder="长期塑造方向、想达到的程度、固定规则、关系设定和希望逐渐建立的习惯…"
            />
            <CollapsibleTextEditor
              title="Punishment"
              value={state.trainingConfig.punishmentGoal}
              maxLength={12000}
              onChange={(punishmentGoal) => patchTrainingConfig({ punishmentGoal })}
              placeholder="哪些情况判定未通过、如何纠正、惩罚怎样与原任务关联、如何再次验收与偿还…"
            />
          </div>

          <div className="collar-section-title collar-settings-divider"><strong>Pet Today</strong><span>STATE TEXT</span></div>
          {(Object.keys(TRAINING_MODE_META) as TrainingMode[]).map((mode) => (
            <CollapsibleTextEditor
              key={mode}
              title={TRAINING_MODE_META[mode].label}
              value={state.trainingConfig.modePreferences[mode].content}
              maxLength={8000}
              onChange={(content) => patchModePreference(mode, { content })}
              placeholder={`${TRAINING_MODE_META[mode].label} 意味着什么、喜欢怎样的任务和语气，以及拒绝出现什么…`}
            />
          ))}

          <div className="collar-section-title collar-settings-divider"><strong>AI 连接</strong><span>CONNECTION</span></div>
          <div className="collar-segmented collar-connection-tabs">
            {([
              ["profile", "Profile"],
              ["api", "API"]
            ] as const).map(([panel, label]) => (
              <button
                key={panel}
                type="button"
                className={connectionPanel === panel ? "selected" : ""}
                onClick={() => setConnectionPanel(panel)}
              >
                {label}
              </button>
            ))}
          </div>
          {connectionPanel === "profile" ? (
            <div className="collar-connection-panel">
              <div className="collar-connection-heading">
                <strong>Profile JSON</strong>
                <span>{profileStatus || "仅保存在当前浏览器"}</span>
              </div>
              <textarea
                value={profileJson}
                onChange={(event) => setProfileJson(event.target.value)}
                placeholder="粘贴 Profile JSON；默认仅包含 <char> / <user> 占位符。"
                spellCheck={false}
              />
              <button className="collar-secondary" type="button" onClick={applyProfileJson}>
                识别并写入 Profile
              </button>
              <div className="collar-timer-settings-row">
                <label className="collar-field collar-timer-field">
                  <span>{state.settings.fixedTimerEnabled ? "固定计时（分钟）" : "最长计时（分钟）"}</span>
                  <input
                    type="number"
                    min={1}
                    max={120}
                    value={Math.round(state.settings.hiddenTimerMaxSeconds / 60)}
                    onChange={(event) => {
                      const seconds = Math.max(60, Math.min(7200, Math.round(Number(event.target.value) * 60)));
                      setState((previous) => ({
                        ...previous,
                        settings: {
                          ...previous.settings,
                          hiddenTimerMinSeconds: Math.min(previous.settings.hiddenTimerMinSeconds, seconds),
                          hiddenTimerMaxSeconds: seconds
                        }
                      }));
                    }}
                  />
                </label>
                <Toggle
                  label="固定计时"
                  checked={state.settings.fixedTimerEnabled}
                  onChange={(value) => setState((previous) => ({
                    ...previous,
                    settings: { ...previous.settings, fixedTimerEnabled: value }
                  }))}
                />
              </div>
              <label className="collar-field collar-morning-time-field">
                <span>每日早安时间（UTC+8）</span>
                <input
                  type="time"
                  value={state.settings.trainingDayStart}
                  onChange={(event) => setState((previous) => ({
                    ...previous,
                    settings: { ...previous.settings, trainingDayStart: event.target.value || "08:00" }
                  }))}
                />
              </label>
              <div className="collar-toggle-list">
                <Toggle label="隐藏倒计时" checked={state.settings.allowHiddenTimer} onChange={(value) => setState((previous) => ({ ...previous, settings: { ...previous.settings, allowHiddenTimer: value } }))} />
                <Toggle label="提示音" checked={state.settings.soundEnabled} onChange={(value) => setState((previous) => ({ ...previous, settings: { ...previous.settings, soundEnabled: value } }))} />
                <Toggle label="震动" checked={state.settings.vibrationEnabled} onChange={(value) => setState((previous) => ({ ...previous, settings: { ...previous.settings, vibrationEnabled: value } }))} />
              </div>
            </div>
          ) : (
            <div className="collar-connection-panel collar-api-panel">
              <div className="collar-connection-heading">
                <strong>Collar API</strong>
                <span>Key 默认为空，不会进入导出文件</span>
              </div>
              <div className="collar-segmented">
                {(["mock", "user-key", "backend-proxy"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={state.settings.aiMode === mode ? "selected" : ""}
                    onClick={() => setState((previous) => ({
                      ...previous,
                      settings: { ...previous.settings, aiMode: mode }
                    }))}
                  >
                    {mode}
                  </button>
                ))}
              </div>
              {state.settings.aiMode === "user-key" ? (
                <>
                  <label className="collar-field">
                    <span>Base URL</span>
                    <input
                      value={state.settings.baseURL}
                      placeholder="https://api.example.com/v1"
                      onChange={(event) => setState((previous) => ({
                        ...previous,
                        settings: { ...previous.settings, baseURL: event.target.value }
                      }))}
                    />
                  </label>
                  <label className="collar-field">
                    <span>API Key</span>
                    <input
                      type="password"
                      value={state.settings.apiKey}
                      autoComplete="off"
                      onChange={(event) => setState((previous) => ({
                        ...previous,
                        settings: { ...previous.settings, apiKey: event.target.value }
                      }))}
                    />
                  </label>
                  <label className="collar-field">
                    <span>Model</span>
                    <input
                      value={state.settings.model}
                      placeholder="model-name"
                      onChange={(event) => setState((previous) => ({
                        ...previous,
                        settings: { ...previous.settings, model: event.target.value }
                      }))}
                    />
                  </label>
                  <label className="collar-field">
                    <span>Temperature</span>
                    <input
                      type="number"
                      min={0}
                      max={2}
                      step={0.1}
                      value={state.settings.temperature}
                      onChange={(event) => setState((previous) => ({
                        ...previous,
                        settings: {
                          ...previous.settings,
                          temperature: Math.max(0, Math.min(2, Number(event.target.value) || 0))
                        }
                      }))}
                    />
                  </label>
                  <label className="collar-field">
                    <span>Max Tokens</span>
                    <input
                      type="number"
                      min={256}
                      max={8000}
                      value={state.settings.maxTokens}
                      onChange={(event) => setState((previous) => ({
                        ...previous,
                        settings: {
                          ...previous.settings,
                          maxTokens: Math.max(256, Math.min(8000, Number(event.target.value) || 256))
                        }
                      }))}
                    />
                  </label>
                  <p>仅限个人私用。浏览器直连模式不适合公开部署。</p>
                </>
              ) : state.settings.aiMode === "backend-proxy" ? (
                <p>从服务器环境变量读取连接信息。请参考仓库中的 <code>.env.example</code>。</p>
              ) : (
                <p>本地模拟模式不会调用任何外部 API，适合首次运行和离线测试。</p>
              )}
            </div>
          )}

          <div className="collar-section-title collar-settings-divider"><strong>数据</strong><span>LOCAL ARCHIVE</span></div>
          <div className="collar-data-actions">
            <button type="button" onClick={exportJson}>导出 JSON</button>
            <button type="button" onClick={() => importRef.current?.click()}>导入 JSON</button>
            <button className="danger" type="button" onClick={clearAll}>清空全部数据</button>
            <button type="button" onClick={() => setState((previous) => ({
              ...previous,
              profile: { ...DEFAULT_PROFILE },
              trainingConfig: structuredClone(DEFAULT_TRAINING_CONFIG),
              settings: { ...DEFAULT_SETTINGS },
              polling: { ...DEFAULT_POLLING }
            }))}>恢复默认配置</button>
          </div>
          <input ref={importRef} type="file" accept="application/json" hidden onChange={(event) => void importJson(event)} />
        </section>
      ) : null}

      <nav className="collar-nav">
        <button type="button" className={surface === "terminal" ? "active" : ""} onClick={() => setSurface("terminal")}>终端</button>
        <button type="button" className={surface === "archive" ? "active" : ""} onClick={() => setSurface("archive")}>档案</button>
        <button type="button" className={surface === "settings" ? "active" : ""} onClick={() => setSurface("settings")}>设置</button>
      </nav>

      {execution ? (
        <section
          className={`collar-execution ${execution.status === "executing" ? "is-waiting" : "is-reporting"}`}
          role="dialog"
          aria-modal="true"
          data-timer-visibility={executionTimerVisibility}
          onClick={handleExecutionTap}
        >
          <div className="collar-execution-top">
            <span>{execution.task.title}</span>
            <button type="button" onClick={() => void emergencyExit()}>紧急退出</button>
          </div>
          {execution.status === "executing" ? (
            <div className="collar-waiting-shell">
              {executionTimerVisibility === "hidden" ? (
                <div className="collar-timer-dock collar-hidden-timer" data-testid="hidden-timer">
                  <div className="collar-wait-pulse" aria-hidden />
                  <div>
                    <span>HIDDEN TIMER</span>
                    <p className="collar-wait-copy">{execution.task.timer.displayTextWhileWaiting}</p>
                  </div>
                </div>
              ) : executionTimerVisibility === "visible" ? (
                <div className="collar-timer-dock collar-visible-timer-block" data-testid="visible-timer">
                  <div>
                    <span>TIME REMAINING</span>
                    <p className="collar-wait-copy">{execution.task.timer.displayTextWhileWaiting}</p>
                  </div>
                  <strong className="collar-visible-timer">{formatDuration(remainingSeconds)}</strong>
                </div>
              ) : null}
              <div className="collar-waiting">
                <span className="collar-execution-trigger">{execution.task.triggerWord}</span>
                <h2>{execution.task.openingCommand}</h2>
                <ol>
                  {execution.task.steps.map((step, index) => (
                    <li key={`${step.label}-${index}`}>
                      <strong>{step.label}</strong>
                      <p>{step.instruction}</p>
                    </li>
                  ))}
                </ol>
                {executionTimerVisibility === "none" ? (
                  <button className="collar-primary" type="button" onClick={finishUntimedTask}>执行完毕，回来汇报</button>
                ) : null}
              </div>
              <div className="collar-tap-effects" data-testid="execution-interactions" aria-hidden>
                {tapResponses.map((response) => (
                  <div className="collar-tap-response" key={response.id}>
                    <div
                      className={`collar-cat-paw is-${response.side}`}
                      style={{ left: response.pawX, top: response.pawY }}
                    >
                      🐾
                    </div>
                    <div
                      className={`collar-owner-bubble is-${response.side}`}
                      style={{ left: response.bubbleX, top: response.bubbleY }}
                    >
                      <small>{state.profile.ownerName || "主人"} // LIVE</small>
                      <p>{response.message}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="collar-report">
              <span className="collar-stamp">RETURNED</span>
              <h2>{execution.task.timer.endText || "回来。现在汇报。"}</h2>
              <p>{execution.task.report.prompt}</p>
              <textarea
                autoFocus
                value={report}
                onChange={(event) => setReport(event.target.value)}
                placeholder="把欲望、反抗、羞耻、服从和身体反应交上来…"
              />
              <div className="collar-report-count">
                <span>{report.trim().length} / {execution.task.report.minLength}</span>
                <span>{execution.task.completionText}</span>
              </div>
              <button
                className="collar-primary"
                type="button"
                disabled={submitting || (execution.task.report.required && report.trim().length < execution.task.report.minLength)}
                onClick={() => void submitReport()}
              >
                {submitting ? "正在验收…" : "提交验收"}
              </button>
            </div>
          )}
        </section>
      ) : null}

      {verdictRecord ? (
        <section className="collar-verdict-overlay" role="dialog" aria-modal="true">
          <article className="collar-verdict-sheet">
            <span className={`collar-verdict-stamp ${verdictRecord.interrupted || verdictRecord.verdictStatus === "punishment" ? "interrupted" : ""}`}>
              {verdictRecord.interrupted
                ? "INTERRUPTED"
                : verdictRecord.verdictStatus === "punishment" ? "PUNISHMENT" : "ACCEPTED"}
            </span>
            <small>{formatTerminalDate(verdictRecord.date)} · {TYPE_LABELS[verdictRecord.type]} · 强度 {verdictRecord.intensity}</small>
            <h2>{verdictRecord.title}</h2>
            <blockquote>{verdictRecord.ownerVerdict}</blockquote>
            {verdictDebt?.status === "converted" && verdictRecord.correctionKind === "punishment" ? (
              <div className="collar-verdict-debt">
                <span>RETRY LIMIT REACHED</span>
                <strong>惩罚欠账已折算点数</strong>
                <p>唯一一次补交仍未通过。坏猫值 +{verdictDebt.pointPenalty}，这笔欠账不再继续生成任务。</p>
              </div>
            ) : verdictRecord.verdictStatus === "punishment" && verdictDebt ? (
              <div className="collar-verdict-debt">
                <span>
                  {verdictRecord.correctionKind === "makeup"
                    ? "缺失项仍未补齐"
                    : verdictRecord.correctionKind === "punishment"
                      ? "惩罚只剩一次补交"
                      : "缺失项 + 独立惩罚"}
                </span>
                {verdictRecord.correctionKind ? (
                  <>
                    <strong>
                      {verdictRecord.correctionKind === "makeup"
                        ? verdictDebt.makeup?.title
                        : verdictDebt.assignment.title}
                    </strong>
                    <p>
                      {verdictRecord.correctionKind === "makeup"
                        ? verdictDebt.makeup?.reason
                        : verdictDebt.assignment.reason}
                    </p>
                  </>
                ) : (
                  <>
                    <strong>{verdictDebt.makeup?.title || "补齐原任务缺失项"}</strong>
                    <p>{verdictDebt.makeup?.reason}</p>
                    <strong>{verdictDebt.assignment.title}</strong>
                    <p>{verdictDebt.assignment.reason}</p>
                  </>
                )}
              </div>
            ) : verdictRecord.correctionKind === "makeup" && verdictDebt?.status === "pending" ? (
              <div className="collar-verdict-debt">
                <span>MAKEUP ACCEPTED</span>
                <strong>原任务已经补齐</strong>
                <p>补交通过。独立惩罚仍在欠账中，下一步执行：{verdictDebt.assignment.title}</p>
              </div>
            ) : (
              <div className="collar-reward">
                <span>奖励</span>
                <p>{rewardWait > 0 ? `等待允许 · ${rewardWait}` : verdictRecord.reward.text}</p>
              </div>
            )}
            <button className="collar-primary" type="button" disabled={rewardWait > 0} onClick={() => setVerdictRecord(null)}>
              {rewardWait > 0
                ? "还不许领"
                : verdictRecord.verdictStatus === "punishment"
                  ? verdictDebt?.status === "converted"
                    ? "收下点数并归档"
                    : verdictRecord.correctionKind === "makeup"
                      ? "收下，继续补交"
                      : verdictRecord.correctionKind === "punishment"
                        ? "收下，最后补交一次"
                        : "收下补交与惩罚"
                  : verdictRecord.correctionKind === "makeup" && verdictDebt?.status === "pending"
                    ? "收下，下一步执行惩罚"
                  : "领取并归档"}
            </button>
          </article>
        </section>
      ) : null}
    </main>
  );
}
