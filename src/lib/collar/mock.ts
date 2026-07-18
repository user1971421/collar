import { summarizeRecentHistory } from "./history";
import {
  TASK_TYPES,
  type TaskGenerationContext,
  type TaskType,
  type TrainingTask
} from "./schema";

const EMBODIED_TYPES: TaskType[] = ["mixed", "posture", "hiddenTimer", "edging", "repeat"];

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
    [/等待|倒计时|手机朝下|不许看|不许动/, ["hiddenTimer", "posture", "mixed"]],
    [/姿态|跪|坐好|站好|趴|躺|靠墙|手放|腿分开|腿并拢/, ["posture", "mixed"]],
    [/寸止|边缘|停住|停手/, ["edging", "mixed"]],
    [/实际|动作|执行|网调|限制|控制|摆好|触碰|抚摸/, ["mixed", "posture", "hiddenTimer"]],
    [/羞耻|承认|交代|汇报/, ["confession", "repeat"]],
    [/问答|问题|思考|写下|列出|自我剖析/, ["thinking", "confession"]],
    [/重复|触发词|口头|念出|说出/, ["repeat"]],
    [/奖励|讨赏|允许/, ["reward"]],
    [/安抚|收住|归位/, ["aftercare"]],
    [/组合|严格|加训|高强度/, ["mixed"]]
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
  const requestedTypes = taskTypesFromText(context.modePreference.content);
  const seed = [...context.today].reduce((sum, char) => sum + char.charCodeAt(0), 0) + history.recordCount;

  if (context.selectedMode === "breakdown") {
    const embodiedAvailable = available.filter((type) => EMBODIED_TYPES.includes(type));
    const weighted = ([
      ...requestedTypes.filter((type) => EMBODIED_TYPES.includes(type)),
      ...preferredTypes.filter((type) => EMBODIED_TYPES.includes(type)),
      "mixed",
      "posture",
      "hiddenTimer",
      ...(settings.allowEdging ? ["edging" as TaskType] : []),
      "repeat",
      ...(context.currentStats.resistance >= context.currentStats.obedience
        ? ["mixed", "posture", "repeat"] as TaskType[]
        : [])
    ] as TaskType[]).filter((type) => available.includes(type) && !recentTypes.includes(type));
    const pool = weighted.length
      ? weighted
      : embodiedAvailable.length
        ? embodiedAvailable
        : available.length
          ? available
          : ["thinking"];
    return pool[seed % pool.length] as TaskType;
  }

  const weighted = [
    ...requestedTypes,
    ...preferredTypes,
    ...(context.selectedMode === "gentle" ? ["thinking", "aftercare", "repeat"] as TaskType[] : []),
    ...(context.currentStats.resistance >= context.currentStats.obedience ? ["confession", "mixed"] as TaskType[] : [])
  ].filter((type) => available.includes(type) && !recentTypes.includes(type));
  const pool = weighted.length ? weighted : available.length ? available : ["thinking"];
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
  const mixedSteps: TrainingTask["steps"] = explicit && context.settings.allowEdging
    ? [
        { label: "摆好", instruction: "在私密安全的位置调整衣物到你愿意接受的范围，选择不会疼痛或麻木的跪姿或坐姿，双手先放在大腿上。", requiresUserAction: true },
        { label: "执行", instruction: `按自己的边界慢慢触碰身体，让兴奋升高；接近界线时低声说“停住”，立刻停手。`, requiresUserAction: true },
        { label: "封存", instruction: "双手离开身体，掌心向上放回大腿，手机朝下，保持原姿势直到结束提示。", requiresUserAction: true }
      ]
    : [
        { label: "留下标记", instruction: "把一件随身小物放在屏幕旁边，作为这次命令尚未结束的标记。", requiresUserAction: true },
        { label: "归位", instruction: "选择安全的坐姿或跪姿，双手掌心向上放在大腿上，保持身体端正。", requiresUserAction: true },
        { label: "等待", instruction: "手机朝下，不许偷看时间，不随意换姿；结束提示响起以前留在原位。", requiresUserAction: true }
      ];

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
      description: "在私密、安全的位置摆好姿势。开始以后不再替自己改命令，直到终端把你叫回来。",
      steps: [
        { label: "摆好", instruction: "选择不会造成疼痛或麻木的跪姿或端正坐姿，双手掌心向上放在大腿上。", requiresUserAction: true },
        { label: "锁定", instruction: `低声叫一次“${owner}”，低头，手机朝下；结束提示以前保持手和腿的位置。`, requiresUserAction: true }
      ],
      report: "按事实交代选择的姿势、是否移动过手或腿、最想换姿的时刻，以及结束信号响起时的第一反应。"
    },
    hiddenTimer: {
      title: "不许偷看",
      description: "开始后没有数字。时间不会回答你，你只需要把姿势和注意力留在命令里，等终端决定什么时候叫你回来。",
      steps: [
        { label: "归位", instruction: "在安全位置坐好或跪好，双手固定放在大腿上，闭眼做三次缓慢呼吸。", requiresUserAction: true },
        { label: "触发", instruction: `低声说出“这段时间归 ${owner} 管”，然后把手机朝下。`, requiresUserAction: true },
        { label: "交出时间", instruction: "保持选定姿势，不看屏幕、不自行计数，响了再回来。", requiresUserAction: true }
      ],
      report: "交代实际保持的姿势、有没有偷看或换姿、听到结束提示时双手和身体在哪里。"
    },
    edging: {
      title: "停在允许之前",
      description: explicit
        ? `可以取悦自己、让欲望升高，但不许越过完成的界线。接近时立刻停住，把剩下的交给 ${owner} 决定。`
        : `允许自己接近兴奋的边缘，但不允许完成；任何不适都立刻停止。`,
      steps: [
        { label: "接近", instruction: "慢慢接近，不追求速度；你负责诚实感受，不负责逞强。", requiresUserAction: true },
        { label: "停住", instruction: `感觉接近界线时说“${triggerWord}”，立刻停手，双手离开身体，把手机朝下。`, requiresUserAction: true }
      ],
      report: "按事实交代停在什么程度、是否及时停手、等待期间有没有再次触碰，以及现在的身体反应。"
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
      description: `不是回答问题。摆好身体，把“${triggerWord}”一遍一遍说到动作和声音都服从同一个节奏。`,
      steps: [
        { label: "前四遍", instruction: `坐直或跪好，双手放在大腿上，看着屏幕重复“${triggerWord}”，每遍之间停一次呼吸。`, requiresUserAction: true },
        { label: "后三遍", instruction: `闭眼、低头，继续念出“${triggerWord}”三遍；说完保持姿势三次呼吸。`, requiresUserAction: true }
      ],
      report: "只需交代第几遍开始声音发生变化、有没有漏字或加快，以及完成后保持了什么姿势。"
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
      title: explicit && context.settings.allowEdging ? "摆好、停住、等我叫你" : "摆好以后不许擅自结束",
      description: explicit && context.settings.allowEdging
        ? `这不是问答。先按 ${owner} 的要求摆好，再执行一次被控制的触碰和停止，最后把双手收回去等结束信号。`
        : `这不是思考题。留下开始标记，摆好身体，把一段时间完整交给 ${owner}，结束以前不自行撤掉命令。`,
      steps: mixedSteps,
      report: explicit && context.settings.allowEdging
        ? "依次交代衣物与姿势、触碰是否执行、何时停手、等待时双手放在哪里，以及有没有越过界线。"
        : "依次交代留下了什么标记、保持了什么姿势、有没有偷看或换姿，以及结束信号响起时身体在哪里。"
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
    openingCommand: `${pet}，看着这条命令。今天不是让你回答几个问题；开始以后按顺序执行，直到 ${owner} 的结束提示把你叫回来。`,
    description: selected.description,
    steps: selected.steps,
    timer: {
      enabled: timerEnabled,
      hidden,
      minSeconds,
      maxSeconds,
      displayTextWhileWaiting: "手机朝下。没有允许之前，不必知道还剩多久。",
      endText: "回来。先确认命令已经结束，再把实际执行情况交上来。"
    },
    report: { required: true, prompt: selected.report, minLength: type === "confession" || type === "reward" ? 45 : 24 },
    completionText: "档案已经收下。别急着替自己判定，等验收。",
    statDelta: statDelta(type, intensity),
    reward: {
      type: type === "aftercare" ? "aftercare" : type === "reward" ? "permission" : "praise",
      delaySeconds: 3,
      text: type === "aftercare" ? "今天到这里。过来，安静待在我身边。" : "乖。今天这份执行和服从，我收下了。"
    },
    safety: {
      requiresPrivateSpace: true,
      allowsEmergencyExit: true,
      notes: "只在私密、安全、清醒的状态下执行；疼痛、麻木、眩晕或任何不适都立即退出。"
    }
  };
}
