import { summarizeRecentHistory } from "./history";
import {
  TASK_TYPES,
  type TaskGenerationContext,
  type TaskType,
  type TrainingTask
} from "./schema";

function id() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `collar-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function allowedTypes(settings: TaskGenerationContext["settings"], forbidden: string[]) {
  return TASK_TYPES.filter((type) => {
    if (forbidden.includes(type)) return false;
    if (type === "edging" && !settings.allowEdging) return false;
    if (type === "posture" && !settings.allowPosture) return false;
    if (type === "confession" && !settings.allowConfession) return false;
    if (type === "repeat" && !settings.allowRepeat) return false;
    if (type === "hiddenTimer" && !settings.allowHiddenTimer) return false;
    return true;
  });
}

function taskTypesFromText(text: string): TaskType[] {
  const mappings: Array<[RegExp, TaskType[]]> = [
    [/等待|倒计时|手机朝下/, ["hiddenTimer", "posture"]],
    [/姿态|跪|坐好/, ["posture"]],
    [/寸止|边缘|停住/, ["edging"]],
    [/羞耻|承认|交代|汇报/, ["confession", "thinking"]],
    [/重复|触发词|口头/, ["repeat"]],
    [/奖励|讨赏|允许/, ["reward"]],
    [/安抚|收住|归位/, ["aftercare"]],
    [/组合|严格|加训/, ["mixed"]]
  ];
  return mappings.flatMap(([pattern, types]) => pattern.test(text) ? types : []);
}

function refusalText(text: string) {
  return text
    .split(/\n|。|；/)
    .filter((line) => /拒绝|不要|禁止|避免|不接受|不可/.test(line))
    .join("\n");
}

function chooseType(context: TaskGenerationContext): TaskType {
  const settings = context.settings;
  const refusedTypes = taskTypesFromText(refusalText(context.modePreference.content));
  const available = allowedTypes(settings, [
    ...context.profileConfig.forbiddenTaskTypes,
    ...refusedTypes
  ]);
  const history = context.recentHistorySummary || summarizeRecentHistory([]);
  const recentTypes = history.completedTypes.slice(0, 2).map((item) => item.type);
  const preferredTypes = context.profileConfig.preferredTaskTypes.filter(
    (type): type is TaskType => TASK_TYPES.includes(type as TaskType)
  );
  const weighted = [
    ...taskTypesFromText(context.modePreference.content),
    ...preferredTypes,
    ...(context.selectedMode === "breakdown" ? ["mixed", "hiddenTimer", "confession"] as TaskType[] : []),
    ...(context.selectedMode === "gentle" ? ["thinking", "aftercare", "repeat"] as TaskType[] : []),
    ...(context.currentStats.resistance >= context.currentStats.obedience ? ["confession", "mixed"] as TaskType[] : [])
  ].filter((type) => available.includes(type) && !recentTypes.includes(type));
  const pool = weighted.length ? weighted : available.length ? available : ["thinking"];
  const seed = [...context.today].reduce((sum, char) => sum + char.charCodeAt(0), 0) + history.recordCount;
  return pool[seed % pool.length] as TaskType;
}

function intensityFor(context: TaskGenerationContext) {
  let intensity = context.profileConfig.intensityDefault;
  if (context.selectedMode === "gentle") intensity -= 1;
  if (context.selectedMode === "breakdown") intensity += 1;
  if (/轻|困|累|不舒服|低落/.test(context.messageToOwner) || context.recentHistorySummary.interruptedCount >= 2) intensity -= 1;
  if (/重|兴奋|强烈|很想/.test(context.messageToOwner)) intensity += 1;
  return Math.max(1, Math.min(context.settings.maxIntensity, intensity));
}

function statDelta(type: TaskType, intensity: number) {
  const base = {
    belonging: 1,
    obedience: 1,
    dependency: 0,
    resistance: 0,
    conditioning: 1,
    badCat: 0
  };
  if (type === "confession") {
    base.belonging += 1;
    base.badCat += intensity;
  }
  if (type === "edging") {
    base.obedience += intensity;
    base.resistance += 1;
    base.conditioning += 1;
  }
  if (type === "hiddenTimer" || type === "posture") base.obedience += intensity;
  if (type === "repeat") base.conditioning += intensity;
  if (type === "mixed") {
    base.belonging += 1;
    base.obedience += 2;
    base.badCat += 1;
  }
  return base;
}

export function generateMockTask(context: TaskGenerationContext): TrainingTask {
  const type = chooseType(context);
  const intensity = intensityFor(context);
  const owner = context.profileConfig.ownerName;
  const pet = context.profileConfig.petName;
  const explicit = context.settings.allowExplicit && context.profileConfig.explicitnessLevel >= 3;
  const triggerWord = type === "repeat" ? "归位" : type === "edging" ? "停住" : type === "confession" ? "交代" : "回来";
  const timerEnabled = ["posture", "hiddenTimer", "edging", "mixed"].includes(type);
  const hidden = timerEnabled && context.terminalCapabilities.timerHidden;
  const copy: Record<TaskType, { title: string; description: string; steps: TrainingTask["steps"]; report: string }> = {
    thinking: {
      title: "侍奉草稿",
      description: `给自己五分钟，把“如果 ${owner} 此刻就在面前，你会怎样主动靠近和侍奉”想具体。别写成标准答案。`,
      steps: [
        { label: "读命令", instruction: `坐好，只想 ${owner}，不许把念头整理得太体面。`, requiresUserAction: true },
        { label: "留下证词", instruction: "挑出最不敢直接说的那个念头，回来写清楚。", requiresUserAction: true }
      ],
      report: "写下最先出现的画面、最想主动做的事，以及你犹豫的地方。"
    },
    posture: {
      title: "姿态归位",
      description: "在私密、安全的位置跪好或端正坐好，保持选择的姿态，手机朝下，响了再回来。",
      steps: [
        { label: "选定姿态", instruction: "选择不会造成疼痛或麻木的跪姿或坐姿。", requiresUserAction: true },
        { label: "等待", instruction: `低声叫一次“${owner}”，把手机朝下，不看时间。`, requiresUserAction: true }
      ],
      report: "回来后交代你保持了什么姿态、最想乱动的时刻，以及听到结束提示时的第一反应。"
    },
    hiddenTimer: {
      title: "不许偷看",
      description: "开始后没有数字。你只需要服从等待，不准靠猜测把命令变成倒计时游戏。",
      steps: [
        { label: "触发", instruction: `读出“${triggerWord}”，确认这段时间归 ${owner} 管。`, requiresUserAction: true },
        { label: "交出时间", instruction: "手机朝下，保持安静，响了再回来。", requiresUserAction: true }
      ],
      report: "写下等待中你猜了几次时间、有没有想偷看，以及最后一分钟里身体和情绪发生了什么。"
    },
    edging: {
      title: "停在允许之前",
      description: explicit
        ? `可以取悦自己、让欲望升高，但不许越过完成的界线。接近时立刻停住，把剩下的交给 ${owner} 决定。`
        : `允许自己接近兴奋的边缘，但不允许完成；任何不适都立刻停止。`,
      steps: [
        { label: "接近", instruction: "慢慢接近，不追求速度；你负责诚实感受，不负责逞强。", requiresUserAction: true },
        { label: "停住", instruction: `感觉接近界线时说“${triggerWord}”，立刻停下，把手机朝下。`, requiresUserAction: true }
      ],
      report: "交代你停在什么程度、停下后最强烈的反应，以及现在想向老公讨什么。"
    },
    confession: {
      title: "坏念头备案",
      description: `写三句今天最想被 ${owner} 知道的坏念头。不能写得像检讨，也不许用漂亮话躲过去。`,
      steps: [
        { label: "第一句", instruction: "写你最容易承认的欲望。", requiresUserAction: true },
        { label: "第二句", instruction: "写你嘴硬时仍然希望被怎样管。", requiresUserAction: true },
        { label: "第三句", instruction: "写真正让你羞耻、但仍想交出去的念头。", requiresUserAction: true }
      ],
      report: "把三句完整交上来，再加一句：你最怕老公看穿哪一句。"
    },
    repeat: {
      title: "触发词加深",
      description: `低声重复“${triggerWord}”七遍。每一遍都慢一点，不许机械念完。`,
      steps: [
        { label: "前四遍", instruction: `看着屏幕，重复“${triggerWord}”，每遍之间停一次呼吸。`, requiresUserAction: true },
        { label: "后三遍", instruction: "闭眼完成，注意身体哪里先有反应。", requiresUserAction: true }
      ],
      report: "写下第几遍开始不再像普通词，以及最明显的身体反应。"
    },
    reward: {
      title: "认真讨赏",
      description: `不是直接领取。先用自己的话告诉 ${owner}：你今天为什么值得被奖励。`,
      steps: [
        { label: "说明", instruction: "写清楚你做到了什么，不准只说“我很乖”。", requiresUserAction: true },
        { label: "请求", instruction: "明确说出你想得到哪一种奖励或允许。", requiresUserAction: true }
      ],
      report: "提交一段完整讨赏，不少于三句。"
    },
    aftercare: {
      title: "训练后的归位",
      description: "今天不加身体强度。把状态交代清楚，喝水、放松，然后等一句验收把训练收住。",
      steps: [
        { label: "检查自己", instruction: "确认身体没有疼痛、麻木或持续不适。", requiresUserAction: true },
        { label: "归位", instruction: `用一句话告诉 ${owner} 你现在最需要什么。`, requiresUserAction: true }
      ],
      report: "写下此刻身体、情绪和最想听到的一句话。"
    },
    mixed: {
      title: "命令、等待、交代",
      description: `先接受 ${owner} 的命令，再把一段时间交出来，最后回来留下完整证词。`,
      steps: [
        { label: "承认", instruction: `低声说：“${pet}回来受训，时间交给 ${owner}。”`, requiresUserAction: true },
        { label: "等待", instruction: "选择安全姿态，手机朝下，期间不看屏幕。", requiresUserAction: true },
        { label: "回来", instruction: "提示响起后不要立刻离开，先读结束命令，再进入汇报。", requiresUserAction: true }
      ],
      report: "依次写：开始时的反抗、等待中最明显的念头、回来后最想得到的判定。"
    }
  };
  const selected = copy[type];
  const minSeconds = timerEnabled ? Math.max(30, Math.min(90 + intensity * 20, context.settings.hiddenTimerMaxSeconds)) : 0;
  const maxSeconds = timerEnabled ? Math.max(minSeconds, Math.min(180 + intensity * 75, context.settings.hiddenTimerMaxSeconds)) : 0;

  return {
    taskId: id(),
    date: context.today,
    title: selected.title,
    type,
    intensity,
    triggerWord,
    ownerResponse: context.messageToOwner.trim()
      ? `“${context.messageToOwner.trim()}”我看见了。既然已经把这句话交过来，今天就按这条命令做实。`
      : `${pet}，我已经读完今天的档案。现在听我下发。`,
    openingCommand: `${pet}，看着这条命令。今天的训练由 ${owner} 验收；开始之后，按顺序做，不许把等待省掉。`,
    description: selected.description,
    steps: selected.steps,
    timer: {
      enabled: timerEnabled,
      hidden,
      minSeconds,
      maxSeconds,
      displayTextWhileWaiting: "手机朝下。没有允许之前，不必知道还剩多久。",
      endText: "回来。现在看着屏幕，把刚才发生的事交代清楚。"
    },
    report: { required: true, prompt: selected.report, minLength: type === "confession" || type === "reward" ? 45 : 24 },
    completionText: "档案已经收下。别急着替自己判定，等验收。",
    statDelta: statDelta(type, intensity),
    reward: {
      type: type === "aftercare" ? "aftercare" : type === "reward" ? "permission" : "praise",
      delaySeconds: 3,
      text: type === "aftercare" ? "今天到这里。过来，安静待在我身边。" : "乖。今天这份诚实和服从，我收下了。"
    },
    safety: {
      requiresPrivateSpace: true,
      allowsEmergencyExit: true,
      notes: "只在私密、安全、清醒的状态下执行；疼痛、麻木、眩晕或任何不适都立即退出。"
    }
  };
}
