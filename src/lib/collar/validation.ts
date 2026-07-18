import { jsonrepair } from "jsonrepair";
import { TrainingTaskSchema, type TaskGenerationContext, type TrainingTask } from "./schema";

type TimerBoundsInput = {
  enabled: boolean;
  minSeconds: number;
  maxSeconds: number;
};

type TimerBoundsSettings = {
  hiddenTimerMinSeconds: number;
  hiddenTimerMaxSeconds: number;
  fixedTimerEnabled?: boolean;
};

const EMBODIED_ACTION_PATTERN = /跪|坐好|坐直|站好|站立|趴|躺|靠墙|低头|抬头|闭眼|睁眼|双手|手放|手掌|腿|膝|分开|并拢|脱下|穿上|调整衣物|触碰|抚摸|按住|停住|停手|放开|保持|不许动|不要动|手机朝下|不看屏幕|等待|倒计时|计时|重复|念出|说出|低声说|呼吸|走到|面向|夹住|握住|抬起|放下|转身|弯腰|数到/;
const REFLECTIVE_TASK_PATTERN = /想一想|思考|写下|回答|列出|解释|描述|回忆|分析|为什么|什么感受|哪一句|哪一项|写三句|写一句/;
const EXPLICITLY_TEXTUAL_RUINED_PATTERN = /(?:以|只生成|仅生成|主要是|主体是).{0,12}(?:思考|问答|书写|告解|承认|文字)|(?:思考|问答|书写|告解|承认|文字).{0,12}(?:为主|作为主体|优先于动作)/;

export function resolveTimerVisibility(timer: { enabled: boolean; hidden: boolean }) {
  if (!timer.enabled) return "none" as const;
  return timer.hidden ? "hidden" as const : "visible" as const;
}

export function resolveTimerBounds(timer: TimerBoundsInput, settings: TimerBoundsSettings) {
  if (!timer.enabled) return { minSeconds: 0, maxSeconds: 0 };
  const settingsMax = Math.max(10, Math.min(7200, Math.round(settings.hiddenTimerMaxSeconds)));
  if (settings.fixedTimerEnabled) {
    return { minSeconds: settingsMax, maxSeconds: settingsMax };
  }
  const settingsMin = Math.max(10, Math.min(settingsMax, Math.round(settings.hiddenTimerMinSeconds)));
  const minSeconds = Math.max(settingsMin, Math.min(Math.round(timer.minSeconds), settingsMax));
  const maxSeconds = Math.max(minSeconds, Math.min(Math.round(timer.maxSeconds), settingsMax));
  return { minSeconds, maxSeconds };
}

export function extractAssistantText(payload: unknown) {
  if (payload && typeof payload === "object") {
    const choices = (payload as { choices?: Array<{ message?: { content?: unknown } }> }).choices;
    if (Array.isArray(choices)) return String(choices[0]?.message?.content || "").trim();
  }
  return typeof payload === "string" ? payload.trim() : "";
}

export function parseStrictJson(raw: string) {
  const trimmed = raw.trim();
  const unwrapped = trimmed.startsWith("```")
    ? trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
    : trimmed;
  const objectStart = unwrapped.indexOf("{");
  const objectEnd = unwrapped.lastIndexOf("}");
  const candidate = objectStart >= 0 && objectEnd > objectStart
    ? unwrapped.slice(objectStart, objectEnd + 1)
    : unwrapped;
  try {
    return JSON.parse(candidate) as unknown;
  } catch {
    return JSON.parse(jsonrepair(candidate)) as unknown;
  }
}

function validateRuinedHasExecutableActions(task: TrainingTask, context: TaskGenerationContext) {
  if (context.selectedMode !== "breakdown") return;
  if (EXPLICITLY_TEXTUAL_RUINED_PATTERN.test(context.modePreference.content)) return;

  const requiredSteps = task.steps.filter((step) => step.requiresUserAction);
  const embodiedSteps = requiredSteps.filter((step) => EMBODIED_ACTION_PATTERN.test(step.instruction));
  const reflectiveOnlySteps = requiredSteps.filter(
    (step) => REFLECTIVE_TASK_PATTERN.test(step.instruction) && !EMBODIED_ACTION_PATTERN.test(step.instruction)
  );
  const minimumEmbodiedSteps = task.timer.enabled ? 1 : 2;

  if (embodiedSteps.length < minimumEmbodiedSteps) {
    throw new Error("Ruined task must contain executable actions instead of only reflection or writing");
  }
  if (reflectiveOnlySteps.length > 1) {
    throw new Error("Ruined task contains too many pre-report writing or reflection steps");
  }
  if (requiredSteps.length > 0 && reflectiveOnlySteps.length === requiredSteps.length) {
    throw new Error("Ruined task cannot be a questionnaire");
  }
}

export function validateTaskForContext(raw: unknown, context: TaskGenerationContext): TrainingTask {
  const parsed = TrainingTaskSchema.parse(raw);
  if (context.profileConfig.forbiddenTaskTypes.includes(parsed.type)) {
    throw new Error(`AI returned forbidden task type: ${parsed.type}`);
  }
  if (parsed.type === "edging" && !context.settings.allowEdging) throw new Error("AI returned disabled edging task");
  if (parsed.type === "posture" && !context.settings.allowPosture) throw new Error("AI returned disabled posture task");
  if (parsed.type === "confession" && !context.settings.allowConfession) throw new Error("AI returned disabled confession task");
  if (parsed.type === "repeat" && !context.settings.allowRepeat) throw new Error("AI returned disabled repeat task");
  if (parsed.type === "hiddenTimer" && !context.settings.allowHiddenTimer) throw new Error("AI returned disabled hidden timer task");
  if (!parsed.safety.allowsEmergencyExit) throw new Error("AI task disabled emergency exit");

  validateRuinedHasExecutableActions(parsed, context);
  const { minSeconds, maxSeconds } = resolveTimerBounds(parsed.timer, context.settings);

  return {
    ...parsed,
    date: context.today,
    intensity: Math.min(parsed.intensity, context.settings.maxIntensity),
    timer: {
      ...parsed.timer,
      hidden: parsed.timer.enabled && context.settings.allowHiddenTimer,
      minSeconds,
      maxSeconds
    }
  };
}
