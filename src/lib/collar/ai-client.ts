"use client";

import { buildTaskPrompt, buildVerdictPrompt, TASK_GENERATOR_SYSTEM_PROMPT, VERDICT_SYSTEM_PROMPT } from "./prompts";
import { generateMockTask } from "./mock";
import type {
  CollarSettings,
  PunishmentAssignment,
  PunishmentDebt,
  ProfileConfig,
  TaskGenerationContext,
  TrainingRecord,
  TrainingRequestSnapshot,
  TrainingTask,
  TrainingVerdict
} from "./schema";
import { TrainingVerdictSchema } from "./schema";
import { extractAssistantText, parseStrictJson, validateTaskForContext } from "./validation";

export type GenerationResult = {
  task: TrainingTask;
  source: "mock" | "user-key" | "backend-proxy" | "fallback";
  note?: string;
};

function completionBody(settings: CollarSettings, messages: Array<{ role: "system" | "user"; content: string }>) {
  const reasoning = /^(gpt-5|o1|o3|o4)/i.test(settings.model);
  return {
    model: settings.model,
    messages,
    stream: false,
    ...(reasoning
      ? { max_completion_tokens: settings.maxTokens }
      : { temperature: settings.temperature, max_tokens: settings.maxTokens })
  };
}

async function userKeyCompletion(settings: CollarSettings, messages: Array<{ role: "system" | "user"; content: string }>) {
  if (!settings.apiKey.trim() || !settings.baseURL.trim() || !settings.model.trim()) {
    throw new Error("user-key 配置不完整");
  }
  const response = await fetch(`${settings.baseURL.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(completionBody(settings, messages))
  });
  if (!response.ok) throw new Error(`user-key API returned ${response.status}`);
  return response.json() as Promise<unknown>;
}

export async function generateTask(context: TaskGenerationContext, privateSettings: CollarSettings): Promise<GenerationResult> {
  if (privateSettings.aiMode === "mock") {
    return { task: generateMockTask(context), source: "mock" };
  }

  try {
    let raw: unknown;
    if (privateSettings.aiMode === "user-key") {
      raw = await userKeyCompletion(privateSettings, [
        { role: "system", content: TASK_GENERATOR_SYSTEM_PROMPT },
        { role: "user", content: buildTaskPrompt(context) }
      ]);
    } else {
      const response = await fetch("/api/generate-task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context })
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(String(error?.error || `backend proxy returned ${response.status}`));
      }
      const payload = await response.json();
      raw = payload.task;
    }
    const task = privateSettings.aiMode === "user-key"
      ? validateTaskForContext(parseStrictJson(extractAssistantText(raw)), context)
      : validateTaskForContext(raw, context);
    return { task, source: privateSettings.aiMode };
  } catch (error) {
    console.error("[collar] AI task generation failed; using mock fallback", error);
    return {
      task: generateMockTask(context),
      source: "fallback",
      note: error instanceof Error ? error.message : "AI 返回无法解析"
    };
  }
}

function localPunishmentFromGoal(
  profile: ProfileConfig,
  task: TrainingTask,
  punishmentGoal: string
): PunishmentAssignment {
  const basis = punishmentGoal.trim().replace(/\s+/g, " ").slice(0, 280)
    || "使用短时安全等待、姿态保持、口头重复或诚实承认生成一条独立惩罚。";
  const candidates = [
    { kind: "repeat", index: basis.search(/重复|口头|念|说/) },
    { kind: "posture", index: basis.search(/姿态|跪|站|坐好|保持/) },
    { kind: "waiting", index: basis.search(/等待|计时|延迟/) },
    { kind: "control", index: basis.search(/欲望|高潮|寸止|控制|停住/) },
    { kind: "confession", index: basis.search(/汇报|承认|羞耻|交代/) },
    { kind: "service", index: basis.search(/服务|侍奉|讨赏/) }
  ].filter((candidate) => candidate.index >= 0).sort((left, right) => left.index - right.index);
  const kind = candidates[0]?.kind || "rule";
  const common = {
    reason: `本次验收未通过。惩罚依据主人写下的 Punishment 设定生成：${basis}`,
    intensity: Math.max(1, Math.min(5, task.intensity)),
    completionText: "惩罚完成后回来交代，等待主人重新验收。"
  };

  if (kind === "repeat") {
    return {
      ...common,
      title: "把规矩说到听懂",
      openingCommand: `${profile.petName}，这不是原任务的补交。按主人写下的惩罚规则，把该记住的话认真说完。`,
      steps: [
        { label: "选定惩罚句", instruction: "从 Punishment 设定中提炼一句最能纠正这次状态的话。", requiresUserAction: true },
        { label: "重复", instruction: "低声重复七遍，每一遍都说完整，不许机械赶完。", requiresUserAction: true },
        { label: "停住", instruction: "说完后安静停留三次呼吸，再回来汇报。", requiresUserAction: true }
      ],
      timer: {
        enabled: false,
        hidden: false,
        minSeconds: 0,
        maxSeconds: 0,
        displayTextWhileWaiting: "",
        endText: "回来。说清哪一遍开始真正听懂。"
      },
      report: {
        required: true,
        prompt: "写下你重复的句子、第几遍开始产生变化，以及这条惩罚纠正了什么。",
        minLength: Math.max(30, task.report.minLength)
      }
    };
  }

  if (kind === "posture" || kind === "waiting") {
    return {
      ...common,
      title: kind === "posture" ? "姿态惩戒" : "时间由主人收走",
      openingCommand: `${profile.petName}，按 Punishment 设定归位。这是一条新的惩罚，不是重做刚才的任务。`,
      steps: [
        { label: "归位", instruction: "选择安全、不造成疼痛或麻木的站姿、跪姿或端正坐姿。", requiresUserAction: true },
        { label: "接受惩罚", instruction: "保持姿态，把这段时间交给主人；不适时立即停止。", requiresUserAction: true },
        { label: "回来", instruction: "提示结束后先确认身体状态，再进入惩罚汇报。", requiresUserAction: true }
      ],
      timer: {
        enabled: true,
        hidden: true,
        minSeconds: 60,
        maxSeconds: 180,
        displayTextWhileWaiting: "这段时间属于惩罚档案。没有提示之前，安静待好。",
        endText: "回来。现在交代这段惩罚。"
      },
      report: {
        required: true,
        prompt: "写下保持的姿态、最想离开的时刻，以及你怎样理解主人选择这条惩罚。",
        minLength: Math.max(30, task.report.minLength)
      }
    };
  }

  if (kind === "control") {
    return {
      ...common,
      title: "允许被暂时收回",
      openingCommand: `${profile.petName}，这次惩罚按 Punishment 设定执行。把追求满足的主动权暂时交出来。`,
      steps: [
        { label: "承认", instruction: "说清楚这是一条独立惩罚，不是原任务的延长。", requiresUserAction: true },
        { label: "停在允许前", instruction: "只保持对欲望的觉察，不追求完成；任何不适立即停止。", requiresUserAction: true },
        { label: "等待", instruction: "手机朝下，提示结束后再回来交代反应。", requiresUserAction: true }
      ],
      timer: {
        enabled: true,
        hidden: true,
        minSeconds: 60,
        maxSeconds: 180,
        displayTextWhileWaiting: "允许由主人保管。响了再回来。",
        endText: "回来。把被收回允许后的反应交上来。"
      },
      report: {
        required: true,
        prompt: "交代欲望、反抗和等待中的变化，以及这条惩罚如何重新建立秩序。",
        minLength: Math.max(35, task.report.minLength)
      }
    };
  }

  return {
    ...common,
    title: kind === "service" ? "服务意识惩戒" : "不许修饰的惩罚交代",
    openingCommand: `${profile.petName}，按主人写下的 Punishment 设定接受一条新的纠正任务。`,
    steps: [
      { label: "读规则", instruction: `认真读完这条惩罚依据：${basis}`, requiresUserAction: true },
      {
        label: kind === "service" ? "提出服务" : "留下承认",
        instruction: kind === "service"
          ? "写出三项现在愿意主动交给主人选择的私密服务，不许写成空泛口号。"
          : "写三句不修饰的承认：哪里偏离了规则、现在最抗拒什么、愿意怎样重新归位。",
        requiresUserAction: true
      },
      { label: "等待验收", instruction: "完成后不要替自己宣布结束，回来交给主人判定。", requiresUserAction: true }
    ],
    timer: {
      enabled: false,
      hidden: false,
      minSeconds: 0,
      maxSeconds: 0,
      displayTextWhileWaiting: "",
      endText: "回来。提交惩罚汇报。"
    },
    report: {
      required: true,
      prompt: kind === "service"
        ? "交上三项具体服务，并说明哪一项最能体现你重新接受秩序。"
        : "交上三句承认，并说明这条惩罚与你的 Punishment 设定怎样对应。",
      minLength: Math.max(35, task.report.minLength)
    }
  };
}

function localMakeupFromTask(task: TrainingTask): PunishmentAssignment {
  const requiredSteps = task.steps.filter((step) => step.requiresUserAction);
  return {
    title: `补齐：${task.title}`,
    reason: "汇报明确承认原任务没有完整执行。只补交遗漏的必做项目，已经完成的部分不重复计算。",
    intensity: task.intensity,
    openingCommand: "对照原命令，把刚才漏掉、跳过或没有做到要求的部分逐项补齐。已经完成的部分不用重做。",
    steps: (requiredSteps.length ? requiredSteps : task.steps).slice(0, 6).map((step) => ({
      ...step,
      instruction: `仅在这一项刚才没有完成时补做：${step.instruction}`
    })),
    timer: task.timer,
    report: {
      required: true,
      prompt: `逐项写清刚才缺了什么、现在补了什么。${task.report.prompt}`,
      minLength: Math.max(20, task.report.minLength)
    },
    completionText: "缺失项补齐后回来验收；通过后仍要另行偿还惩罚。"
  };
}

function localVerdict(
  profile: ProfileConfig,
  task: TrainingTask,
  report: string,
  interrupted: boolean,
  punishmentGoal: string,
  correctionKind?: "makeup" | "punishment",
  correctionAttempt = 0
): TrainingVerdict {
  if (interrupted) {
    return {
      status: "passed",
      ownerVerdict: `${profile.ownerName}记下了这次退出。停下不等于逃掉，状态先收好，下一次再回来交代。`,
      makeup: null,
      punishment: null
    };
  }
  const admittedFailure = /没做|没有做|没完成|没有完成|跳过|放弃|敷衍|编的|乱写/.test(report);
  if (admittedFailure) {
    if (correctionKind === "makeup") {
      return {
        status: "punishment",
        ownerVerdict: "缺失项还没有补齐。只把仍然遗漏的部分重新交上来，不新增惩罚。",
        makeup: localMakeupFromTask(task),
        punishment: null
      };
    }
    if (correctionKind === "punishment") {
      return {
        status: "punishment",
        ownerVerdict: correctionAttempt >= 2
          ? "惩罚补交仍未通过。终端不再生成下一轮，按本次惩罚强度结算坏猫值。"
          : "这笔惩罚没有完成。只允许再补交一次，下一次仍不过就直接结算坏猫值。",
        makeup: null,
        punishment: correctionAttempt >= 2
          ? null
          : localPunishmentFromGoal(profile, task, punishmentGoal)
      };
    }
    return {
      status: "punishment",
      ownerVerdict: "这份汇报没有达到要求。原命令缺失的部分必须补齐，另外按 Punishment 设定留下一条独立惩罚。",
      makeup: localMakeupFromTask(task),
      punishment: localPunishmentFromGoal(profile, task, punishmentGoal)
    };
  }
  if (report.length >= 100) {
    return {
      status: "passed",
      ownerVerdict: `乖。没有拿几句漂亮话糊弄过去，今天这份反应和诚实都已经被 ${profile.ownerName} 收进档案。`,
      makeup: null,
      punishment: null
    };
  }
  return {
    status: "passed",
    ownerVerdict: task.statDelta.resistance > 0
      ? "嘴硬也记进档案了。你还是按命令回来，把该交代的交代清楚，这就值得收下。"
      : "今天没有逃，也没有省掉汇报。乖，这一页我亲自收下，奖励等允许再领。",
    makeup: null,
    punishment: null
  };
}

function assertVerdictForContext(
  verdict: TrainingVerdict,
  correctionKind?: "makeup" | "punishment",
  correctionAttempt = 0
) {
  if (verdict.status === "passed") return verdict;
  if (!correctionKind && (!verdict.makeup || !verdict.punishment)) {
    throw new Error("regular failed verdict must include makeup and punishment");
  }
  if (correctionKind === "makeup" && !verdict.makeup) {
    throw new Error("failed makeup verdict must include makeup");
  }
  if (correctionKind === "punishment" && correctionAttempt < 2 && !verdict.punishment) {
    throw new Error("first failed punishment verdict must include one retry");
  }
  return verdict;
}

export async function generateVerdict(input: {
  settings: CollarSettings;
  profile: ProfileConfig;
  task: TrainingTask;
  personaProfile?: string;
  requestSnapshot?: TrainingRequestSnapshot;
  report: string;
  interrupted: boolean;
  recentRecords: TrainingRecord[];
  punishmentGoal?: string;
  correctionKind?: "makeup" | "punishment";
  correctionAttempt?: number;
  pendingPunishments?: PunishmentDebt[];
}) {
  if (!input.settings.aiVerdictEnabled || input.settings.aiMode === "mock") {
    return localVerdict(
      input.profile,
      input.task,
      input.report,
      input.interrupted,
      input.punishmentGoal || "",
      input.correctionKind,
      input.correctionAttempt
    );
  }
  const prompt = buildVerdictPrompt({
    ...input,
    pendingPunishments: input.pendingPunishments?.map((punishment) => ({
      title: punishment.assignment.title,
      assignedTrainingDay: punishment.assignedTrainingDay,
      failureCount: punishment.failureCount
    }))
  });
  try {
    let raw: unknown;
    if (input.settings.aiMode === "user-key") {
      raw = await userKeyCompletion({ ...input.settings, maxTokens: Math.min(input.settings.maxTokens, 1600) }, [
        { role: "system", content: VERDICT_SYSTEM_PROMPT },
        { role: "user", content: prompt }
      ]);
      raw = parseStrictJson(extractAssistantText(raw));
    } else {
      const response = await fetch("/api/generate-verdict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile: input.profile,
          personaProfile: input.personaProfile || "",
          requestSnapshot: input.requestSnapshot,
          task: input.task,
          report: input.report,
          interrupted: input.interrupted,
          recentRecords: input.recentRecords.slice(-7),
          punishmentGoal: input.punishmentGoal || "",
          correctionKind: input.correctionKind,
          correctionAttempt: input.correctionAttempt || 0,
          pendingPunishments: input.pendingPunishments || []
        })
      });
      if (!response.ok) throw new Error(`verdict proxy returned ${response.status}`);
      raw = await response.json();
    }
    return assertVerdictForContext(
      TrainingVerdictSchema.parse(raw),
      input.correctionKind,
      input.correctionAttempt
    );
  } catch (error) {
    console.error("[collar] AI verdict failed; using local verdict", error);
    return localVerdict(
      input.profile,
      input.task,
      input.report,
      input.interrupted,
      input.punishmentGoal || "",
      input.correctionKind,
      input.correctionAttempt
    );
  }
}
