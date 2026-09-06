import { useState, useEffect, useRef } from 'react';
import { Icons } from '../constants';
import { isoToBr, brToIso, maskBrDate } from '../lib/dates';

// Input de data para campos personalizados/tabela. Inputs nativos <input
// type="date"> disparam onChange a cada tecla digitada, inclusive enquanto
// a data está incompleta (ex: só o dia e mês, ou só 1-2 dígitos do ano) —
// nesses casos `e.target.value` vem vazio. Sem tratamento isso causava dois
// problemas: (1) cada tecla parcial disparava um upsert salvando valor
// vazio, criando uma corrida entre requisições que podia sobrescrever a
// data completa digitada por último com uma parcial que resolveu depois;
// (2) como o valor exibido é controlado pela prop `value` (só atualizada
// depois que o upsert assíncrono termina), qualquer re-render do app nesse
// intervalo (ex: outra tarefa mudando via realtime) forçava o campo de
// volta ao valor antigo, apagando visualmente o que o usuário tinha
// acabado de digitar — exatamente o sintoma relatado de "a data não fica
// gravada assim que termino de digitar o ano". Por isso: (a) mantemos um
// valor local que não depende do round-trip de rede para continuar exibindo
// o que foi digitado, e (b) só disparamos onCommit quando o usuário termina
// uma data válida ou explicitamente limpa um valor que já existia.
//
// Exibe e aceita entrada SEMPRE em dd/mm/aaaa — o <input type="date"> nativo
// formatava no locale do NAVEGADOR (mostrava mm/dd/aaaa para muitos
// usuários, apesar da página ser pt-BR — issue #102, achado 1). Aqui o texto
// é um input mascarado determinístico; o calendário nativo continua
// disponível num input oculto acionado pelo botão (showPicker). O valor
// persistido continua ISO 'YYYY-MM-DD'. O buffer local preserva o que foi
// digitado independentemente do round-trip do upsert.
export function DateFieldEditor({ value, onCommit, className, ariaLabel }: { value: any; onCommit: (v: string) => void; className?: string; ariaLabel?: string }) {
  const [text, setText] = useState(() => isoToBr(value ?? ''));
  const pickerRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setText(isoToBr(value ?? '')); }, [value]);

  const commitFromText = (raw: string) => {
    const masked = maskBrDate(raw);
    setText(masked);
    if (masked === '') { if (value) onCommit(''); return; }
    const iso = brToIso(masked);
    if (iso) onCommit(iso); // só persiste data completa e válida
  };

  return (
    <div className="relative">
      <input
        type="text"
        inputMode="numeric"
        placeholder="dd/mm/aaaa"
        aria-label={ariaLabel}
        title={ariaLabel}
        value={text}
        onChange={(e) => commitFromText(e.target.value)}
        className={`${className ?? ''} pr-9`}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label="Abrir calendário"
        onClick={() => pickerRef.current?.showPicker?.()}
        className="absolute inset-y-0 right-0 flex items-center px-2 text-gray-400 hover:text-gray-600"
      >
        <Icons.Calendar className="h-4 w-4" />
      </button>
      <input
        ref={pickerRef}
        type="date"
        value={value ?? ''}
        onChange={(e) => { const v = e.target.value; setText(isoToBr(v)); if (v || value) onCommit(v); }}
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only absolute right-0 bottom-0"
      />
    </div>
  );
}
