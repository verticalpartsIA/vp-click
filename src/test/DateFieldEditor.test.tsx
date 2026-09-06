import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import { useState } from "react";
import { DateFieldEditor } from "../components/DateFieldEditor";

// O DateFieldEditor exibe/edita SEMPRE em dd/mm/aaaa (input mascarado,
// independente do locale do navegador) e persiste em ISO (YYYY-MM-DD).
// O input de texto mascarado é o principal; há também um <input type="date">
// OCULTO só para o calendário nativo (showPicker).
const textInput = (c: HTMLElement) =>
  c.querySelector('input[type="text"]') as HTMLInputElement;

// Reproduz o bug original: o usuário termina de digitar uma data (o "commit"
// só acontece quando o valor fica completo/válido), mas o salvamento é
// assíncrono (upsert no Supabase). Se algo re-renderiza o pai nesse intervalo
// com o valor antigo (ex: uma tarefa mudando via realtime em outro lugar do
// app), o campo não deve reverter para o valor antigo/vazio.
function Harness({ delayMs }: { delayMs: number }) {
  const [saved, setSaved] = useState<string | undefined>(undefined);
  const [unrelatedTick, setUnrelatedTick] = useState(0);

  const onCommit = (v: string) => {
    setTimeout(() => setSaved(v), delayMs);
  };

  return (
    <div>
      <button onClick={() => setUnrelatedTick((t) => t + 1)}>bump {unrelatedTick}</button>
      <DateFieldEditor value={saved} onCommit={onCommit} />
    </div>
  );
}

describe("DateFieldEditor", () => {
  it("keeps the typed date visible while the async save is in flight, even if an unrelated re-render happens", async () => {
    vi.useFakeTimers();
    const { container, getByText } = render(<Harness delayMs={300} />);
    const input = textInput(container);

    // O usuário digita a data completa em dd/mm/aaaa.
    fireEvent.change(input, { target: { value: "21/07/2026" } });
    expect(input.value).toBe("21/07/2026");

    // Um re-render não relacionado (ex: outra tarefa atualizada via realtime)
    // ocorre ANTES do upsert assíncrono terminar. Como o `value` (prop) ainda
    // não mudou, o buffer local não é sobrescrito.
    fireEvent.click(getByText(/bump/));
    expect(input.value).toBe("21/07/2026");

    // O upsert assíncrono agora termina (value passa a "2026-07-21").
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(input.value).toBe("21/07/2026");

    vi.useRealTimers();
  });

  it("commits the completed date in ISO format", () => {
    const onCommit = vi.fn();
    const { container } = render(<DateFieldEditor value={undefined} onCommit={onCommit} />);
    fireEvent.change(textInput(container), { target: { value: "21/07/2026" } });
    expect(onCommit).toHaveBeenCalledWith("2026-07-21");
  });

  it("does not commit while the date is incomplete", () => {
    const onCommit = vi.fn();
    const { container } = render(<DateFieldEditor value={undefined} onCommit={onCommit} />);
    const input = textInput(container);

    fireEvent.change(input, { target: { value: "21" } });
    fireEvent.change(input, { target: { value: "21/07" } });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("does not commit an invalid date (e.g. 31/02)", () => {
    const onCommit = vi.fn();
    const { container } = render(<DateFieldEditor value={undefined} onCommit={onCommit} />);
    fireEvent.change(textInput(container), { target: { value: "31/02/2026" } });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("shows an ISO value as dd/mm/aaaa", () => {
    const { container } = render(<DateFieldEditor value="2026-07-21" onCommit={vi.fn()} />);
    expect(textInput(container).value).toBe("21/07/2026");
  });

  it("commits an explicit clear when a previously saved value is removed", () => {
    const onCommit = vi.fn();
    const { container } = render(<DateFieldEditor value="2026-07-21" onCommit={onCommit} />);
    fireEvent.change(textInput(container), { target: { value: "" } });
    expect(onCommit).toHaveBeenCalledWith("");
  });
});
