import { STAT_KEYS, type CollarStats, type TrainingRecord } from "./schema";

const DAY_MS = 86_400_000;

export function localDateKey(date = new Date()) {
  const utc8 = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const year = utc8.getUTCFullYear();
  const month = String(utc8.getUTCMonth() + 1).padStart(2, "0");
  const day = String(utc8.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function utcDay(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

export function shiftDate(dateKey: string, offset: number) {
  const value = new Date(utcDay(dateKey) + offset * DAY_MS);
  return value.toISOString().slice(0, 10);
}

export function calculateCheckIn(records: TrainingRecord[], today = localDateKey()) {
  const completedDays = Array.from(new Set(records
    .filter((record) => (
      !record.interrupted
      && !record.isPunishment
      && !record.correctionKind
      && record.verdictStatus !== "punishment"
    ))
    .map((record) => record.date))).sort();
  const completed = new Set(completedDays);
  let currentStreak = 0;
  let cursor = completed.has(today) ? today : shiftDate(today, -1);
  while (completed.has(cursor)) {
    currentStreak += 1;
    cursor = shiftDate(cursor, -1);
  }

  let longestStreak = 0;
  let run = 0;
  let previous = "";
  for (const day of completedDays) {
    run = previous && shiftDate(previous, 1) === day ? run + 1 : 1;
    longestStreak = Math.max(longestStreak, run);
    previous = day;
  }
  return { currentStreak, longestStreak, totalDays: completedDays.length };
}

export function summarizeRecentHistory(records: TrainingRecord[], today = localDateKey()) {
  const since = shiftDate(today, -6);
  const recent = records.filter((record) => record.date >= since && record.date <= today);
  const typeCounts: Record<string, number> = {};
  const triggerWords: string[] = [];
  const statGrowth = Object.fromEntries(STAT_KEYS.map((key) => [key, 0])) as CollarStats;
  let reportCharacters = 0;
  let interruptedCount = 0;

  for (const record of recent) {
    typeCounts[record.type] = (typeCounts[record.type] || 0) + 1;
    reportCharacters += record.userReport.trim().length;
    if (record.interrupted) interruptedCount += 1;
    if (record.triggerWord && !triggerWords.includes(record.triggerWord)) triggerWords.push(record.triggerWord);
    for (const key of STAT_KEYS) statGrowth[key] += Number(record.statDelta[key] || 0);
  }

  const sortedTypes = Object.entries(typeCounts).sort((left, right) => right[1] - left[1]);
  const topStat = [...STAT_KEYS].sort((left, right) => statGrowth[right] - statGrowth[left])[0];
  const preferenceSignals = [
    (typeCounts.hiddenTimer || 0) + (typeCounts.posture || 0) >= 2 ? "喜欢等待" : "",
    recent.filter((record) => record.userReport.length >= 80).length >= 2 ? "喜欢详细汇报" : "",
    (typeCounts.edging || 0) >= 1 ? "接受寸止" : "",
    (typeCounts.confession || 0) >= 1 ? "接受羞耻承认" : "",
    interruptedCount >= 2 || statGrowth.resistance >= 4 ? "近期反抗明显" : ""
  ].filter(Boolean);

  return {
    windowDays: 7,
    recordCount: recent.length,
    completedTypes: sortedTypes.map(([type, count]) => ({ type, count })),
    interruptedCount,
    averageReportLength: recent.length ? Math.round(reportCharacters / recent.length) : 0,
    triggerWords: triggerWords.slice(0, 12),
    statGrowth,
    largestGrowthStat: statGrowth[topStat] > 0 ? topStat : "",
    preferenceSignals,
    recentTitles: recent.slice(-5).map((record) => record.title)
  };
}

export function yesterdayRecord(records: TrainingRecord[], today = localDateKey()) {
  const yesterday = shiftDate(today, -1);
  return [...records].reverse().find((record) => record.date === yesterday) || null;
}

export function applyStatDelta(stats: CollarStats, delta: CollarStats) {
  return Object.fromEntries(
    STAT_KEYS.map((key) => [key, Math.max(0, Math.min(999, Math.round(stats[key] + delta[key])))])
  ) as CollarStats;
}
