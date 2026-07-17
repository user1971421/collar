import { NextRequest, NextResponse } from "next/server";
import type { TaskGenerationContext } from "@/lib/collar/schema";
import { buildTaskPrompt, TASK_GENERATOR_SYSTEM_PROMPT } from "@/lib/collar/prompts";
import { extractAssistantText, parseStrictJson, validateTaskForContext } from "@/lib/collar/validation";
import { serverCompletion } from "@/lib/server-ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (!body?.context || typeof body.context !== "object") {
      throw new Error("context required");
    }
    const context = body.context as TaskGenerationContext;
    const raw = await serverCompletion([
      { role: "system", content: TASK_GENERATOR_SYSTEM_PROMPT },
      { role: "user", content: buildTaskPrompt(context) }
    ], context.settings.maxTokens);
    const task = validateTaskForContext(
      parseStrictJson(extractAssistantText(raw)),
      context
    );
    return NextResponse.json({ ok: true, task });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "task generation failed"
    }, { status: 422 });
  }
}
