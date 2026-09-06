import { describe, it, expect, vi, afterEach } from "vitest";
import {
  parseLocalDate,
  formatLocalDate,
  toDateSafe,
  isoToBr,
  brToIso,
  maskBrDate,
  formatDateBR,
  formatShortDateBR,
  relativeTimeBR,
  dateGroupLabelBR,
  formatDateTimeNumericBR,
} from "../lib/dates";

afterEach(() => {
  vi.useRealTimers();
});

describe("parseLocalDate / formatLocalDate", () => {
  it("round-trips a date without shifting day (issue #102, achado 3)", () => {
    const d = parseLocalDate("2026-03-01");
    expect(formatLocalDate(d)).toBe("2026-03-01");
  });

  it("does not fall to the previous day, unlike new Date(iso) cru", () => {
    // Reprodução do bug original: em fusos atrás de UTC, `new Date("YYYY-MM-DD")`
    // (meia-noite UTC) pode cair no dia anterior ao ler .getDate() localmente.
    const d = parseLocalDate("2026-01-01");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(0);
    expect(d.getDate()).toBe(1);
  });

  it("ignores a trailing time component", () => {
    const d = parseLocalDate("2026-07-15T10:30:00");
    expect(formatLocalDate(d)).toBe("2026-07-15");
  });
});

describe("toDateSafe", () => {
  it("parses a pure YYYY-MM-DD as local midnight (like parseLocalDate)", () => {
    expect(toDateSafe("2026-05-20").getDate()).toBe(20);
  });

  it("parses a full timestamp directly (safe: already carries time/zone)", () => {
    const d = toDateSafe("2026-05-20T23:00:00Z");
    expect(d.getTime()).toBe(new Date("2026-05-20T23:00:00Z").getTime());
  });
});

describe("isoToBr / brToIso", () => {
  it("round-trips a valid date", () => {
    expect(isoToBr("2026-12-25")).toBe("25/12/2026");
    expect(brToIso("25/12/2026")).toBe("2026-12-25");
  });

  it("rejects an impossible date (31 de fevereiro)", () => {
    expect(brToIso("31/02/2026")).toBe("");
  });

  it("rejects incomplete/malformed input", () => {
    expect(brToIso("25/12")).toBe("");
    expect(brToIso("")).toBe("");
  });

  it("isoToBr returns '' for empty/malformed input", () => {
    expect(isoToBr("")).toBe("");
    expect(isoToBr("not-a-date")).toBe("");
  });
});

describe("maskBrDate", () => {
  it("applies the dd/mm/aaaa mask progressively", () => {
    expect(maskBrDate("2")).toBe("2");
    expect(maskBrDate("25")).toBe("25");
    expect(maskBrDate("2512")).toBe("25/12");
    expect(maskBrDate("25122026")).toBe("25/12/2026");
  });

  it("strips non-digits and caps at 8 digits", () => {
    expect(maskBrDate("25/12/2026extra")).toBe("25/12/2026");
  });
});

describe("formatDateBR / formatShortDateBR", () => {
  it("formats a task date (YYYY-MM-DD) as dd/mm/aaaa", () => {
    expect(formatDateBR("2026-03-01")).toBe("01/03/2026");
  });

  it("formats a task date as dd mon (short, no year)", () => {
    // "mar" é a abreviação de março em pt-BR (Intl.DateTimeFormat).
    expect(formatShortDateBR("2026-03-01")).toMatch(/^01 de mar\.?$|^01 mar\.?$/);
  });

  it("returns '' for empty input", () => {
    expect(formatDateBR("")).toBe("");
    expect(formatDateBR(undefined)).toBe("");
  });
});

describe("relativeTimeBR", () => {
  it("returns 'agora' for a timestamp seconds ago", () => {
    const now = new Date("2026-06-15T12:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(relativeTimeBR(new Date(now.getTime() - 30_000).toISOString())).toBe("agora");
  });

  it("returns 'ontem' for exactly one day ago", () => {
    const now = new Date("2026-06-15T12:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const yesterday = new Date(now.getTime() - 25 * 60 * 60_000).toISOString();
    expect(relativeTimeBR(yesterday)).toBe("ontem");
  });

  it("falls back to a short date after a week", () => {
    const now = new Date("2026-06-15T12:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const longAgo = new Date("2026-01-01T12:00:00Z").toISOString();
    expect(relativeTimeBR(longAgo)).toBe(formatShortDateBR(longAgo));
  });
});

describe("dateGroupLabelBR", () => {
  it("labels today, yesterday and older buckets", () => {
    const now = new Date("2026-06-15T12:00:00");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(dateGroupLabelBR(now.toISOString())).toBe("Hoje");
    expect(dateGroupLabelBR(new Date("2026-06-14T12:00:00").toISOString())).toBe("Ontem");
    expect(dateGroupLabelBR(new Date("2026-01-01T12:00:00").toISOString())).toBe("Mais antigas");
  });
});

describe("formatDateTimeNumericBR", () => {
  it("formats a full timestamp as dd/mm/aaaa, hh:mm", () => {
    expect(formatDateTimeNumericBR("2026-03-01T14:30:00Z")).toMatch(/^\d{2}\/\d{2}\/2026, \d{2}:\d{2}$/);
  });

  it("returns the raw input on an unparseable value instead of throwing", () => {
    expect(formatDateTimeNumericBR("nao-e-uma-data")).toBe("nao-e-uma-data");
  });
});
