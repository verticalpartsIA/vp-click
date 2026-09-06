// Motor de cálculo de recorrência (issue #184, fase 2) — cópia Deno de
// src/lib/recurrence.ts (fonte da verdade, testada em src/test/recurrence.test.ts).
// Deno não consegue importar caminhos relativos fora de supabase/functions/,
// então este arquivo é reenviado a cada deploy — manter em sincronia manual
// com src/lib/recurrence.ts sempre que o motor mudar.

export type RecurrenceFrequencyType = 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom';
export type RecurrenceWeekendShift = 'next_business_day' | 'previous_business_day' | 'skip';

export interface RecurrenceRuleForCalc {
  frequencyType: RecurrenceFrequencyType;
  interval: number;
  weekdays: number[];
  monthDay?: number | null;
  monthWeek?: number | null;
  monthWeekday?: number | null;
  timezone: string;
  skipWeekends: boolean;
  skipHolidays?: boolean;
  weekendShift: RecurrenceWeekendShift;
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function utcToWallClock(date: Date, timeZone: string): WallClock {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour') % 24,
    minute: get('minute'),
    second: get('second'),
  };
}

function wallClockToUtc(wall: WallClock, timeZone: string): Date {
  const naiveUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  const offsetMs = naiveUtc - utcToWallClockMs(new Date(naiveUtc), timeZone);
  return new Date(naiveUtc + offsetMs);
}
function utcToWallClockMs(date: Date, timeZone: string): number {
  const w = utcToWallClock(date, timeZone);
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function weekdayOf(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function addMonths(wall: WallClock, months: number): WallClock {
  const total = (wall.month - 1) + months;
  const year = wall.year + Math.floor(total / 12);
  const month = (((total % 12) + 12) % 12) + 1;
  return { ...wall, year, month };
}

function isWeekend(year: number, month: number, day: number): boolean {
  const dow = weekdayOf(year, month, day);
  return dow === 0 || dow === 6;
}

function dateKey(year: number, month: number, day: number): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)}`;
}

function isNonBusinessDay(
  year: number, month: number, day: number,
  rule: RecurrenceRuleForCalc, holidays: ReadonlySet<string> | undefined,
): boolean {
  if (rule.skipWeekends && isWeekend(year, month, day)) return true;
  if (rule.skipHolidays && holidays?.has(dateKey(year, month, day))) return true;
  return false;
}

function applyWeekendShift(
  wall: WallClock, rule: RecurrenceRuleForCalc, holidays?: ReadonlySet<string>,
): WallClock | null {
  if (!isNonBusinessDay(wall.year, wall.month, wall.day, rule, holidays)) return wall;
  if (rule.weekendShift === 'skip') return null;
  const stepDays = rule.weekendShift === 'previous_business_day' ? -1 : 1;
  let { year, month, day } = wall;
  for (let i = 0; i < 10 && isNonBusinessDay(year, month, day, rule, holidays); i++) {
    const next = new Date(Date.UTC(year, month - 1, day + stepDays));
    year = next.getUTCFullYear();
    month = next.getUTCMonth() + 1;
    day = next.getUTCDate();
  }
  return { ...wall, year, month, day };
}

function nextDailyDate(afterWall: WallClock, rule: RecurrenceRuleForCalc): WallClock {
  const next = new Date(Date.UTC(afterWall.year, afterWall.month - 1, afterWall.day + rule.interval));
  return { ...afterWall, year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() };
}

function nextWeeklyDate(afterWall: WallClock, rule: RecurrenceRuleForCalc, startWall: WallClock): WallClock {
  const weekdays = rule.weekdays.length > 0 ? [...rule.weekdays].sort((a, b) => a - b) : [weekdayOf(startWall.year, startWall.month, startWall.day)];
  const afterEpochDay = Math.floor(Date.UTC(afterWall.year, afterWall.month - 1, afterWall.day) / 86400000);
  const afterDow = weekdayOf(afterWall.year, afterWall.month, afterWall.day);
  const weekStartEpochDay = afterEpochDay - afterDow;
  for (const wd of weekdays) {
    const candidateEpochDay = weekStartEpochDay + wd;
    if (candidateEpochDay > afterEpochDay) {
      const d = new Date(candidateEpochDay * 86400000);
      return { ...afterWall, year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
    }
  }
  const nextWeekStart = weekStartEpochDay + 7 * Math.max(1, rule.interval);
  const candidateEpochDay = nextWeekStart + weekdays[0];
  const d = new Date(candidateEpochDay * 86400000);
  return { ...afterWall, year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function resolveMonthDay(year: number, month: number, monthDay: number): number {
  return Math.min(monthDay, daysInMonth(year, month));
}

function resolveNthWeekday(year: number, month: number, weekday: number, nth: number): number {
  const first = weekdayOf(year, month, 1);
  const firstOccurrence = 1 + ((weekday - first + 7) % 7);
  if (nth !== 5) return firstOccurrence + (nth - 1) * 7;
  let day = firstOccurrence;
  while (day + 7 <= daysInMonth(year, month)) day += 7;
  return day;
}

function nextMonthlyDate(afterWall: WallClock, rule: RecurrenceRuleForCalc): WallClock {
  let cursor = addMonths(afterWall, 0);
  for (let i = 0; i <= 60; i++) {
    cursor = addMonths(afterWall, i * Math.max(1, rule.interval));
    const day = rule.monthWeek != null && rule.monthWeekday != null
      ? resolveNthWeekday(cursor.year, cursor.month, rule.monthWeekday, rule.monthWeek)
      : resolveMonthDay(cursor.year, cursor.month, rule.monthDay ?? afterWall.day);
    const candidate = { ...afterWall, year: cursor.year, month: cursor.month, day };
    const candidateEpochDay = Date.UTC(candidate.year, candidate.month - 1, candidate.day);
    const afterEpochDay = Date.UTC(afterWall.year, afterWall.month - 1, afterWall.day);
    if (candidateEpochDay > afterEpochDay) return candidate;
  }
  return cursor;
}

function nextYearlyDate(afterWall: WallClock, rule: RecurrenceRuleForCalc, startWall: WallClock): WallClock {
  let year = afterWall.year;
  const month = startWall.month;
  const day = resolveMonthDay(year, month, startWall.day);
  const thisYearEpoch = Date.UTC(year, month - 1, day);
  const afterEpoch = Date.UTC(afterWall.year, afterWall.month - 1, afterWall.day);
  if (thisYearEpoch <= afterEpoch) year += Math.max(1, rule.interval);
  return { ...afterWall, year, month, day: resolveMonthDay(year, month, startWall.day) };
}

export function calcNextOccurrence(
  rule: RecurrenceRuleForCalc,
  after: Date,
  startAt: Date,
  holidays?: ReadonlySet<string>,
): Date | null {
  const afterWall = utcToWallClock(after, rule.timezone);
  const startWall = utcToWallClock(startAt, rule.timezone);

  let dateWall: WallClock;
  switch (rule.frequencyType) {
    case 'daily':
      dateWall = nextDailyDate(afterWall, rule);
      break;
    case 'weekly':
    case 'custom':
      dateWall = nextWeeklyDate(afterWall, rule, startWall);
      break;
    case 'monthly':
      dateWall = nextMonthlyDate(afterWall, rule);
      break;
    case 'yearly':
      dateWall = nextYearlyDate(afterWall, rule, startWall);
      break;
    default:
      return null;
  }

  dateWall = { ...dateWall, hour: startWall.hour, minute: startWall.minute, second: startWall.second };

  const shifted = applyWeekendShift(dateWall, rule, holidays);
  if (!shifted) return null;
  return wallClockToUtc(shifted, rule.timezone);
}

export function calcNextValidOccurrence(
  rule: RecurrenceRuleForCalc,
  after: Date,
  startAt: Date,
  holidays?: ReadonlySet<string>,
): Date | null {
  let cursor = after;
  for (let i = 0; i < 366; i++) {
    const next = calcNextOccurrence(rule, cursor, startAt, holidays);
    if (next === null) {
      cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
      continue;
    }
    return next;
  }
  return null;
}
