import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  ProfileConfigSchema,
  PunishmentDebtSchema,
  TrainingRequestSnapshotSchema,
  TrainingTaskSchema,
  TrainingVerdictSchema,
  type TrainingRecord
} from "@/lib/collar/schema";
import { buildVerdictPrompt, VERDICT_SYSTEM_PROMPT } from "@/lib/collar/prompts";
import { extractAssistantText, parseStrictJson } from "@/lib/collar/validation";
import { serverCompletion } from "@/lib/server-ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const profile = ProfileConfigSchema.parse(body?.profile);
    const task = TrainingTaskSchema.parse(body?.task);
    const requestSnapshot = body?.requestSnapshot
      ? TrainingRequestSnapshotSchema.parse(body.requestSnapshot)
      : undefined;
    const pendingPunishments = z.array(PunishmentDebtSchema)
      .max(100)
      .parse(Array.isArray(body?.pendingPunishments) ? body.pendingPunishments : []);
    const correctionKind = body?.correctionKind === "makeup" || body?.correctionKind === "punishment"
      ? body.correctionKind
      : undefined;
    const correctionAttempt = Math.max(0, Math.min(2, Number(body?.correctionAttempt) || 0));
    const prompt = buildVerdictPrompt({
      profile,
      personaProfile: String(body?.personaProfile || "").slice(0, 12000),
      requestSnapshot,
      task,
      report: String(body?.report || "").slice(0, 6000),
      interrupted: Boolean(body?.interrupted),
      recentRecords: (Array.isArray(body?.recentRecords) ? body.recentRecords : []) as TrainingRecord[],
      punishmentGoal: String(body?.punishmentGoal || requestSnapshot?.punishmentGoal || "").slice(0, 12000),
      correctionKind,
      correctionAttempt,
      pendingPunishments: pendingPunishments.map((punishment) => ({
        title: punishment.assignment.title,
        assignedTrainingDay: punishment.assignedTrainingDay,
        failureCount: punishment.failureCount
      }))
    });
    const raw = await serverCompletion([
      { role: "system", content: VERDICT_SYSTEM_PROMPT },
      { role: "user", content: prompt }
    ], 1800);
    const verdict = TrainingVerdictSchema.parse(parseStrictJson(extractAssistantText(raw)));
    return NextResponse.json(verdict);
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "verdict generation failed"
    }, { status: 422 });
  }
}
