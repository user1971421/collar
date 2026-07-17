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
