import { describe, it, expect } from 'vitest';
import { calcNextOccurrence, calcNextValidOccurrence, RecurrenceRuleForCalc } from '../lib/recurrence';

const baseRule: RecurrenceRuleForCalc = {
  frequencyType: 'daily',
  interval: 1,
  weekdays: [],
  monthDay: null,
  monthWeek: null,
  monthWeekday: null,
  timezone: 'America/Sao_Paulo',
  skipWeekends: false,
  weekendShift: 'next_business_day',
};

// Datas de referência em UTC representando 09:00 horário de Brasília
// (12:00 UTC, sem DST desde 2019).
const startAt = new Date('2026-09-07T12:00:00Z'); // segunda-feira

describe('calcNextOccurrence — daily', () => {
  it('avança 1 dia por padrão', () => {
    const next = calcNextOccurrence(baseRule, startAt, startAt);
    expect(next?.toISOString()).toBe('2026-09-08T12:00:00.000Z');
  });

  it('respeita interval > 1', () => {
    const rule = { ...baseRule, interval: 3 };
    const next = calcNextOccurrence(rule, startAt, startAt);
    expect(next?.toISOString()).toBe('2026-09-10T12:00:00.000Z');
  });
});

describe('calcNextOccurrence — weekly', () => {
  it('próxima ocorrência dentro da mesma semana', () => {
    const rule: RecurrenceRuleForCalc = { ...baseRule, frequencyType: 'weekly', weekdays: [1, 3, 5] }; // seg/qua/sex
    const next = calcNextOccurrence(rule, startAt, startAt); // startAt é segunda
    expect(next?.getUTCDay()).toBe(3); // próxima é quarta
  });

  it('múltiplos dias da semana avança pra semana seguinte quando necessário', () => {
    const rule: RecurrenceRuleForCalc = { ...baseRule, frequencyType: 'weekly', weekdays: [1] }; // só segunda
    const next = calcNextOccurrence(rule, startAt, startAt);
    expect(next?.toISOString()).toBe('2026-09-14T12:00:00.000Z'); // segunda seguinte
  });

  it('respeita interval > 1 (quinzenal)', () => {
    const rule: RecurrenceRuleForCalc = { ...baseRule, frequencyType: 'weekly', weekdays: [1], interval: 2 };
    const after = new Date('2026-09-14T12:00:00Z'); // segunda seguinte já usada
    const next = calcNextOccurrence(rule, after, startAt);
    expect(next?.toISOString()).toBe('2026-09-28T12:00:00.000Z'); // pula 2 semanas
  });
});

describe('calcNextOccurrence — monthly', () => {
  it('dia fixo do mês', () => {
    const rule: RecurrenceRuleForCalc = { ...baseRule, frequencyType: 'monthly', monthDay: 7 };
    const next = calcNextOccurrence(rule, startAt, startAt);
    expect(next?.toISOString()).toBe('2026-10-07T12:00:00.000Z');
  });

  it('último dia do mês (clamp em fevereiro)', () => {
    const rule: RecurrenceRuleForCalc = { ...baseRule, frequencyType: 'monthly', monthDay: 31 };
    const after = new Date('2027-01-31T12:00:00Z');
    const next = calcNextOccurrence(rule, after, startAt);
    expect(next?.getUTCMonth()).toBe(1); // fevereiro (0-indexed)
    expect(next?.getUTCDate()).toBe(28); // 2027 não é bissexto
  });

  it('enésimo dia da semana do mês (ex.: 2ª terça-feira)', () => {
    const rule: RecurrenceRuleForCalc = { ...baseRule, frequencyType: 'monthly', monthWeek: 2, monthWeekday: 2 };
    const next = calcNextOccurrence(rule, startAt, startAt);
    // Setembro/2026: 1ª terça = dia 1, 2ª terça = dia 8
    expect(next?.toISOString()).toBe('2026-09-08T12:00:00.000Z');
  });

  it('última ocorrência do dia da semana no mês (nth=5)', () => {
    const rule: RecurrenceRuleForCalc = { ...baseRule, frequencyType: 'monthly', monthWeek: 5, monthWeekday: 1 }; // última segunda
    const next = calcNextOccurrence(rule, startAt, startAt);
    expect(next?.toISOString()).toBe('2026-09-28T12:00:00.000Z'); // última segunda de set/2026
  });
});

describe('calcNextOccurrence — yearly', () => {
  it('mesmo mês/dia do ano seguinte', () => {
    const rule: RecurrenceRuleForCalc = { ...baseRule, frequencyType: 'yearly' };
    const next = calcNextOccurrence(rule, startAt, startAt);
    expect(next?.toISOString()).toBe('2027-09-07T12:00:00.000Z');
  });

  it('respeita interval > 1', () => {
    const rule: RecurrenceRuleForCalc = { ...baseRule, frequencyType: 'yearly', interval: 2 };
    const next = calcNextOccurrence(rule, startAt, startAt);
    expect(next?.toISOString()).toBe('2028-09-07T12:00:00.000Z');
  });
});

describe('skip de fins de semana', () => {
  it('weekend_shift=next_business_day desloca sábado pra segunda', () => {
    // 2026-09-12 é sábado
    const rule: RecurrenceRuleForCalc = { ...baseRule, skipWeekends: true, weekendShift: 'next_business_day' };
    const after = new Date('2026-09-11T12:00:00Z'); // sexta
    const next = calcNextOccurrence(rule, after, startAt);
    expect(next?.getUTCDay()).toBe(1); // segunda
  });

  it('weekend_shift=previous_business_day desloca domingo pra sexta', () => {
    const rule: RecurrenceRuleForCalc = { ...baseRule, skipWeekends: true, weekendShift: 'previous_business_day' };
    const after = new Date('2026-09-12T12:00:00Z'); // sábado -> próxima seria domingo
    const next = calcNextOccurrence(rule, after, startAt);
    expect(next?.getUTCDay()).toBe(5); // sexta
  });

  it('weekend_shift=skip retorna null pra ocorrência em fim de semana', () => {
    const rule: RecurrenceRuleForCalc = { ...baseRule, skipWeekends: true, weekendShift: 'skip' };
    const after = new Date('2026-09-11T12:00:00Z'); // sexta -> próxima seria sábado
    const next = calcNextOccurrence(rule, after, startAt);
    expect(next).toBeNull();
  });

  it('calcNextValidOccurrence pula ocorrências em fim de semana automaticamente', () => {
    const rule: RecurrenceRuleForCalc = { ...baseRule, skipWeekends: true, weekendShift: 'skip' };
    const after = new Date('2026-09-11T12:00:00Z'); // sexta
    const next = calcNextValidOccurrence(rule, after, startAt);
    expect(next).not.toBeNull();
    expect(next!.getUTCDay()).not.toBe(0);
    expect(next!.getUTCDay()).not.toBe(6);
  });
});

describe('feriados (skip_holidays)', () => {
  it('weekend_shift=next_business_day desloca feriado numa terça pra quarta', () => {
    const rule: RecurrenceRuleForCalc = { ...baseRule, skipHolidays: true, weekendShift: 'next_business_day' };
    const holidays = new Set(['2026-09-08']); // terça, feriado fictício
    const after = new Date('2026-09-07T12:00:00Z'); // segunda -> próxima seria terça (feriado)
    const next = calcNextOccurrence(rule, after, startAt, holidays);
    expect(next?.toISOString()).toBe('2026-09-09T12:00:00.000Z'); // quarta
  });

  it('feriado emendado com fim de semana pula os 3 dias seguidos', () => {
    // 2026-09-11 é sexta (feriado), 12/13 é fim de semana.
    const rule: RecurrenceRuleForCalc = { ...baseRule, skipWeekends: true, skipHolidays: true, weekendShift: 'next_business_day' };
    const holidays = new Set(['2026-09-11']);
    const after = new Date('2026-09-10T12:00:00Z'); // quinta -> próxima seria sexta (feriado)
    const next = calcNextOccurrence(rule, after, startAt, holidays);
    expect(next?.toISOString()).toBe('2026-09-14T12:00:00.000Z'); // segunda seguinte
  });

  it('sem skipHolidays, data em feriado não é deslocada', () => {
    const rule: RecurrenceRuleForCalc = { ...baseRule, skipHolidays: false };
    const holidays = new Set(['2026-09-08']);
    const after = new Date('2026-09-07T12:00:00Z');
    const next = calcNextOccurrence(rule, after, startAt, holidays);
    expect(next?.toISOString()).toBe('2026-09-08T12:00:00.000Z'); // não desloca
  });
});

describe('timezone', () => {
  it('mantém a hora do dia (wall clock) estável através dos meses', () => {
    const rule: RecurrenceRuleForCalc = { ...baseRule, frequencyType: 'monthly', monthDay: 7 };
    const next = calcNextOccurrence(rule, startAt, startAt);
    // 09:00 em America/Sao_Paulo (sem DST) = 12:00 UTC, estável
    expect(next?.getUTCHours()).toBe(12);
  });
});
