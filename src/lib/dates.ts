// Módulo único de formatação/parse de datas do VP Click (issue #102, achado 3).
//
// Antes desta consolidação, o app tinha três problemas historicamente
// separados que na prática eram o mesmo bug de origem:
//   1. `new Date("YYYY-MM-DD")` interpreta a string como meia-noite UTC, que
//      em fusos atrás de UTC (ex: Brasil) recua pro dia anterior ao formatar
//      em horário local — corrigido caso a caso com `parseLocalDate` ou o
//      hack `+'T00:00:00'`, mas nem todo caminho usava a correção.
//   2. Pelo menos 3 implementações de "formatDate" e 4 cópias idênticas de
//      uma função "relativeTime" espalhadas em componentes diferentes.
//   3. Um ponto (`attachment.uploadedAt`) chamava `toLocaleDateString()` sem
//      locale explícito — o mesmo tipo de bug do `<input type="date">` nativo
//      corrigido no achado 1 (formato depende do locale do navegador).
//
// Este arquivo não redesenha os formatos existentes — cada função abaixo
// preserva exatamente o texto que a tela correspondente já mostrava antes,
// só move a implementação pra um único lugar testável e reaproveitável.
import { isToday, isYesterday } from 'date-fns';

// ---------- Parsing local-safe (sem shift de fuso) ----------

// Datas de tarefa (dueDate/startDate) são strings "YYYY-MM-DD" (sem hora).
// `new Date("YYYY-MM-DD")` interpreta isso como meia-noite UTC, que em fusos
// atrás de UTC (ex: Brasil) cai no dia anterior ao formatar/comparar em
// horário local. Parseamos os componentes manualmente para obter a
// meia-noite local do dia correto.
export function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('T')[0].split('-').map(Number);
  return new Date(y, m - 1, d);
}

// Inverso de parseLocalDate: formata um Date usando os componentes locais
// (ano/mês/dia), nunca `toISOString()` — que converte para UTC e pode
// arredondar para o dia errado em fusos atrás de UTC (ex: Brasil, UTC-3).
export function formatLocalDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Ponto único de conversão string → Date: nenhum outro lugar do app deve
// chamar `new Date(isoString)` cru numa string vinda do banco. Uma data pura
// "YYYY-MM-DD" (dueDate/startDate de tarefa) é interpretada como meia-noite
// LOCAL via parseLocalDate; qualquer outra string (timestamptz do Supabase,
// já com hora e fuso embutidos) é segura para o Date nativo.
export function toDateSafe(value: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? parseLocalDate(value) : new Date(value);
}

// ---------- dd/mm/aaaa ↔ ISO (editor de data mascarado, DateFieldEditor) ----------

// ISO 'YYYY-MM-DD' (formato de armazenamento) → 'dd/mm/aaaa' (exibição pt-BR).
export function isoToBr(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

// 'dd/mm/aaaa' → ISO 'YYYY-MM-DD'. Retorna '' se a data estiver incompleta ou
// for inválida (ex: 31/02) — assim só persistimos datas completas e reais.
export function brToIso(br: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((br || '').trim());
  if (!m) return '';
  const dd = Number(m[1]), mo = Number(m[2]), yyyy = Number(m[3]);
  if (mo < 1 || mo > 12 || dd < 1 || dd > 31) return '';
  const dt = new Date(yyyy, mo - 1, dd);
  if (dt.getFullYear() !== yyyy || dt.getMonth() !== mo - 1 || dt.getDate() !== dd) return '';
  return `${m[3]}-${m[2]}-${m[1]}`;
}

// Aplica a máscara dd/mm/aaaa a uma sequência crua de dígitos.
export function maskBrDate(raw: string): string {
  const d = (raw || '').replace(/\D/g, '').slice(0, 8);
  if (d.length > 4) return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
  if (d.length > 2) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return d;
}

// ---------- Formatação de exibição (todas em pt-BR explícito) ----------

// "dd/mm/aaaa" — data sem hora (prazo/início de tarefa, coluna Prazo da Tabela).
export function formatDateBR(value?: string): string {
  if (!value) return '';
  return toDateSafe(value).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// "dd mon" — data curta sem ano (badges de prazo em listas, cauda do relativeTimeBR).
export function formatShortDateBR(value?: string): string {
  if (!value) return '';
  return toDateSafe(value).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

// "dd mon hh:mm" — data+hora curta (lembretes, "adiado até" do inbox).
export function formatDateTimeShortBR(value?: string): string {
  if (!value) return '';
  return toDateSafe(value).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// "dd mon aaaa, hh:mm" (formato longo padrão do Intl, com "de"/abreviação
// pontuada) — usado nas Reuniões.
export function formatMeetingDateTimeBR(value?: string): string {
  if (!value) return '';
  return toDateSafe(value).toLocaleString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// "dd mon aaaa hh:mm" sem "de"/pontuação — timeline da tarefa (mais compacto
// que o formato longo padrão acima; texto propositalmente diferente).
export function formatDateTimeLongCleanBR(value?: string): string {
  if (!value) return '';
  return toDateSafe(value)
    .toLocaleString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    .replace(' de ', ' ')
    .replace('.', '');
}

// "dd/mm/aaaa hh:mm" — log de automações.
export function formatDateTimeNumericBR(value?: string): string {
  if (!value) return '';
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    }).format(toDateSafe(value));
  } catch {
    return value;
  }
}

export function formatWeekdayShortBR(date: Date): string {
  return date.toLocaleDateString('pt-BR', { weekday: 'short' });
}

// "dd/mm" — usado no prefixo de dia das salas de reunião e no log de
// atividade recente do Dashboard.
export function formatDayMonthNumericBR(date: Date): string {
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

// "agora" / "há X min" / "há Xh" / "ontem" / "há X dias" / "dd mon" — usado
// nas listas de notificação, respostas e comentários atribuídos (antes
// quatro cópias idênticas desta função, uma por arquivo).
export function relativeTimeBR(date: string): string {
  const diffMs = Date.now() - toDateSafe(date).getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'ontem';
  if (d < 7) return `há ${d} dias`;
  return formatShortDateBR(date);
}

// "Hoje" / "Ontem" / "Esta semana" / "Mais antigas" — agrupamento de listas
// por data (antes duplicado idêntico na Caixa de entrada e em Respostas).
export function dateGroupLabelBR(date: string): string {
  const d = toDateSafe(date);
  if (isToday(d)) return 'Hoje';
  if (isYesterday(d)) return 'Ontem';
  const diffDays = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (diffDays < 7) return 'Esta semana';
  return 'Mais antigas';
}
