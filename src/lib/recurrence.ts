// Motor de cálculo de recorrência (issue #184, fase 2) — puro, sem I/O e sem
// nada específico de runtime (roda igual no Node/Vite do app E no Deno da
// Edge Function `task-recurrence-scheduler`, que importa este mesmo arquivo
// pra nunca duplicar a lógica de datas). Testado por
// src/test/recurrence.test.ts.
//
// Datas são representadas como "wall clock" (ano/mês/dia/hora/min) NO FUSO
// da regra, nunca como offset UTC cru — evita o clássico bug de recorrência
// "andar" um dia por causa de DST/fuso (ver seção 10 da issue). Convertemos
// pra Date/ISO (sempre UTC) só na entrada/saída.

export type RecurrenceFrequencyType = 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom';
export type RecurrenceWeekendShift = 'next_business_day' | 'previous_business_day' | 'skip';

export interface RecurrenceRuleForCalc {
  frequencyType: RecurrenceFrequencyType;
  interval: number;
  weekdays: number[]; // 0=domingo..6=sábado (weekly/custom)
  monthDay?: number | null; // dia fixo do mês (monthly) — 31 = "último dia" quando o mês tiver menos dias
  monthWeek?: number | null; // 1..4 = 1ª..4ª ocorrência do dia da semana; 5 = última (monthly "nth weekday")
  monthWeekday?: number | null; // 0..6, usado com monthWeek
  timezone: string; // IANA, ex.: 'America/Sao_Paulo'
  skipWeekends: boolean;
  skipHolidays?: boolean;
  weekendShift: RecurrenceWeekendShift;
}

interface WallClock {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

// ── Conversão UTC <-> wall clock no fuso da regra ────────────────────────
// Sem libs externas: usa Intl.DateTimeFormat (disponível tanto no Deno
// quanto no browser/Node) pra descobrir o offset real do fuso naquele
// instante (cobre DST em fusos que têm — América/São Paulo não tem desde
// 2019, mas a função não assume isso pra continuar correta se mudar de
// novo ou pra outros fusos usados no futuro).
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
    hour: get('hour') % 24, // 'hour12: false' pode devolver "24" pra meia-noite em alguns runtimes
    minute: get('minute'),
    second: get('second'),
  };
}

// Constrói o instante UTC correspondente a um wall-clock naquele fuso,
// pesquisando o offset por aproximação (2 passadas — suficiente pra
// qualquer fuso real, cujo offset é estável ao longo de um dia exceto no
// exato momento da troca de DST, caso irrelevante pra granularidade de
// minuto que usamos aqui).
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

// ── Fins de semana e feriados ────────────────────────────────────────────
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

// Aplica skip_weekends/skip_holidays/weekend_shift a um wall-clock já
// calculado. Nunca muta a data de origem da regra — só desloca a OCORRÊNCIA
// gerada. `holidays` é o calendário corporativo (issue #184 seção 11) — vem
// de fora (banco), não é hardcoded aqui; ausente/vazio = nenhum feriado.
function applyWeekendShift(
  wall: WallClock, rule: RecurrenceRuleForCalc, holidays?: ReadonlySet<string>,
): WallClock | null {
  if (!isNonBusinessDay(wall.year, wall.month, wall.day, rule, holidays)) return wall;

  if (rule.weekendShift === 'skip') return null;

  const stepDays = rule.weekendShift === 'previous_business_day' ? -1 : 1;
  let { year, month, day } = wall;
  // Teto de 10 passos: cobre feriados emendados com fim de semana (ex.:
  // feriado na sexta + sábado + domingo = 3 dias não-úteis seguidos).
  for (let i = 0; i < 10 && isNonBusinessDay(year, month, day, rule, holidays); i++) {
    const next = new Date(Date.UTC(year, month - 1, day + stepDays));
    year = next.getUTCFullYear();
    month = next.getUTCMonth() + 1;
    day = next.getUTCDate();
  }
  return { ...wall, year, month, day };
}

// ── Cálculo por frequência (opera em wall-clock, ignorando hora/minuto —
// resolvidos separadamente a partir de start_at) ─────────────────────────
function nextDailyDate(afterWall: WallClock, rule: RecurrenceRuleForCalc): WallClock {
  const next = new Date(Date.UTC(afterWall.year, afterWall.month - 1, afterWall.day + rule.interval));
  return { ...afterWall, year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() };
}

function nextWeeklyDate(afterWall: WallClock, rule: RecurrenceRuleForCalc, startWall: WallClock): WallClock {
  const weekdays = rule.weekdays.length > 0 ? [...rule.weekdays].sort((a, b) => a - b) : [weekdayOf(startWall.year, startWall.month, startWall.day)];

  // Início da semana (domingo) que contém `afterWall`, em dias desde epoch —
  // usamos aritmética de dias UTC pra não reimplementar calendário à mão.
  const afterEpochDay = Math.floor(Date.UTC(afterWall.year, afterWall.month - 1, afterWall.day) / 86400000);
  const afterDow = weekdayOf(afterWall.year, afterWall.month, afterWall.day);
  const weekStartEpochDay = afterEpochDay - afterDow;

  // Tenta achar o próximo dia da semana >= afterEpochDay+1 dentro da MESMA
  // semana; se não houver, pula `interval` semanas e pega o primeiro
  // weekday configurado.
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

// Dia do mês que representa o "monthDay" configurado, com clamp pro
// último dia real do mês (ex.: monthDay=31 em fevereiro -> 28 ou 29).
function resolveMonthDay(year: number, month: number, monthDay: number): number {
  return Math.min(monthDay, daysInMonth(year, month));
}

// N-ésima ocorrência de um dia da semana no mês (1..4, 5=última).
function resolveNthWeekday(year: number, month: number, weekday: number, nth: number): number {
  const first = weekdayOf(year, month, 1);
  const firstOccurrence = 1 + ((weekday - first + 7) % 7);
  if (nth !== 5) return firstOccurrence + (nth - 1) * 7;
  // Última ocorrência: sobe de 7 em 7 a partir da primeira até estourar o mês.
  let day = firstOccurrence;
  while (day + 7 <= daysInMonth(year, month)) day += 7;
  return day;
}

function nextMonthlyDate(afterWall: WallClock, rule: RecurrenceRuleForCalc): WallClock {
  let cursor = addMonths(afterWall, 0); // cópia
  // i começa em 0: o mês corrente de `after` pode ainda conter uma ocorrência
  // válida (ex.: after = dia 7, "2ª terça" cai dia 8, ainda no mesmo mês).
  for (let i = 0; i <= 60; i++) { // teto de segurança (5 anos) contra configuração impossível
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

/**
 * Calcula a PRÓXIMA ocorrência estritamente depois de `after`, respeitando
 * frequência, fuso horário e skip_weekends/skip_holidays/weekend_shift da
 * regra. `startAt` ancora dia-do-mês (yearly) e hora do dia (todas as
 * frequências usam a hora de startAt, só a data muda). `holidays` é o
 * calendário corporativo (datas 'YYYY-MM-DD' no fuso da regra) — vem de
 * fora (tabela `company_holidays`), esta função não conhece feriados por si.
 *
 * Retorna `null` só quando weekend_shift = 'skip' e a ocorrência calculada
 * cair num dia não-útil (fim de semana ou feriado) — a ocorrência é pulada,
 * não adiada — use calcNextValidOccurrence pra já pular automaticamente até
 * achar uma válida.
 */
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
    case 'custom': // sem campos próprios ainda — trata como semanal (ver README da função)
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

  // Hora do dia vem de startAt, não de `after`.
  dateWall = { ...dateWall, hour: startWall.hour, minute: startWall.minute, second: startWall.second };

  const shifted = applyWeekendShift(dateWall, rule, holidays);
  if (!shifted) return null; // caiu em dia não-útil e weekend_shift = 'skip'
  return wallClockToUtc(shifted, rule.timezone);
}

/**
 * Como calcNextOccurrence, mas quando weekend_shift='skip' pula ocorrências
 * em dia não-útil até achar uma válida (ou até o teto de segurança).
 */
export function calcNextValidOccurrence(
  rule: RecurrenceRuleForCalc,
  after: Date,
  startAt: Date,
  holidays?: ReadonlySet<string>,
): Date | null {
  let cursor = after;
  for (let i = 0; i < 366; i++) { // teto de segurança: 1 ano de tentativas diárias
    const next = calcNextOccurrence(rule, cursor, startAt, holidays);
    if (next === null) {
      // Ocorrência caiu em dia não-útil e foi pulada — avança 1 dia e
      // tenta de novo (suficiente pra diária/semanal; mensal/anual
      // recalculam do zero a cada tentativa, então isso só força uma nova
      // rodada de busca).
      cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
      continue;
    }
    return next;
  }
  return null;
}
