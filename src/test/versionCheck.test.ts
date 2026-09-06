import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { startVersionCheck } from "../lib/versionCheck";

describe("startVersionCheck", () => {
  let onUpdateAvailable: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubGlobal("__APP_BUILD_TIME__", "2026-07-21T10:00:00.000Z");
    vi.useFakeTimers();
    onUpdateAvailable = vi.fn();
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("notifies once a newer build is published on the server", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ buildTime: "2026-07-21T12:30:00.000Z", commit: "abc123" }),
      }),
    );

    const stop = startVersionCheck(onUpdateAvailable);
    await vi.advanceTimersByTimeAsync(15_000);

    expect(onUpdateAvailable).toHaveBeenCalledTimes(1);
    expect(onUpdateAvailable.mock.calls[0][0].message).toContain("21/07/2026");
    expect(onUpdateAvailable.mock.calls[0][0].message).toContain("09:30");

    // Um novo ciclo não deve duplicar o aviso.
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(onUpdateAvailable).toHaveBeenCalledTimes(1);

    stop();
  });

  it("does not notify while the deployed version matches the running one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ buildTime: "2026-07-21T10:00:00.000Z", commit: "abc123" }),
      }),
    );

    const stop = startVersionCheck(onUpdateAvailable);
    await vi.advanceTimersByTimeAsync(15_000);

    expect(onUpdateAvailable).not.toHaveBeenCalled();
    stop();
  });

  it("checks again when the tab becomes visible", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ buildTime: "2026-07-21T10:00:00.000Z", commit: "a" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ buildTime: "2026-07-21T18:00:00.000Z", commit: "b" }) });
    vi.stubGlobal("fetch", fetchMock);

    const stop = startVersionCheck(onUpdateAvailable);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(onUpdateAvailable).not.toHaveBeenCalled();

    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => expect(onUpdateAvailable).toHaveBeenCalledTimes(1));

    stop();
  });

  it("does not repeat the same notification across independent instances (e.g. other tabs, or a remount)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ buildTime: "2026-07-21T12:30:00.000Z", commit: "abc123" }),
      }),
    );

    const stopA = startVersionCheck(onUpdateAvailable);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(onUpdateAvailable).toHaveBeenCalledTimes(1);
    stopA();

    // Segunda instância independente (outra aba com sua própria variável
    // `notified`, ou um remount do componente) — não deve duplicar o aviso,
    // porque o localStorage já registra que esse buildTime foi avisado.
    const stopB = startVersionCheck(onUpdateAvailable);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(onUpdateAvailable).toHaveBeenCalledTimes(1);
    stopB();
  });
});
