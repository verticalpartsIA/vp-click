// task-recurrence-scheduler — issue #184, fase 2.
//
// Disparado pelo pg_cron a cada 5 min (via pg_net.http_post, ver migration
// task_recurrence_phase2_scheduler). Autenticado por segredo compartilhado
// (Vault: task_recurrence_scheduler_secret), não por JWT de usuário — por
// isso o deploy usa verify_jwt=false e a própria função valida o header
// x-scheduler-secret contra o Vault (via RPC get_recurrence_scheduler_secret,
// só executável por service_role).
//
// Usa o client de SERVICE ROLE (bypassa RLS) — correto aqui: é um processo de
// sistema, não uma requisição de usuário; a segurança é o segredo do header,
// não RLS de usuário autenticado.
//
// Idempotência: a criação da ocorrência colide com o índice único parcial
// (recurrence_rule_id, scheduled_occurrence_at) da migration da fase 1 — um
// 23505 nessa etapa é tratado como "já processado por outra execução", não
// como erro.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { calcNextValidOccurrence, RecurrenceRuleForCalc } from './recurrence.ts';

const DONE_KEYWORDS = ['conclu', 'done', 'closed', 'complete', 'finaliz', 'pronto', 'aprovado'];
function isDoneLikeStatus(status: string): boolean {
  const s = (status || '').toLowerCase();
  return DONE_KEYWORDS.some((kw) => s.includes(kw));
}

interface RuleRow {
  id: string;
  task_id: string;
  list_id: string;
  created_by: string | null;
  enabled: boolean;
  frequency_type: string;
  interval: number;
  weekdays: number[];
  month_day: number | null;
  month_week: number | null;
  month_weekday: number | null;
  start_at: string;
  next_run_at: string | null;
  timezone: string;
  trigger_mode: string;
  skip_weekends: boolean;
  skip_holidays: boolean;
  weekend_shift: string;
  end_mode: string;
  end_at: string | null;
  max_occurrences: number | null;
  occurrences_created: number;
  inherit_options: Record<string, boolean>;
  overlap_policy: string;
  misfire_policy: string;
}

function toRuleForCalc(rule: RuleRow): RecurrenceRuleForCalc {
  return {
    frequencyType: rule.frequency_type as RecurrenceRuleForCalc['frequencyType'],
    interval: rule.interval,
    weekdays: rule.weekdays || [],
    monthDay: rule.month_day,
    monthWeek: rule.month_week,
    monthWeekday: rule.month_weekday,
    timezone: rule.timezone,
    skipWeekends: rule.skip_weekends,
    skipHolidays: rule.skip_holidays,
    weekendShift: rule.weekend_shift as RecurrenceRuleForCalc['weekendShift'],
  };
}

// Junta as ocorrências agendadas <= now a partir de next_run_at, e devolve
// junto o próximo horário FUTURO (o que vira o novo next_run_at da regra).
function collectDueOccurrences(rule: RuleRow, nowMs: number, holidays: ReadonlySet<string>): { due: Date[]; following: Date | null } {
  const ruleForCalc = toRuleForCalc(rule);
  const startAt = new Date(rule.start_at);
  const due: Date[] = [];
  let cursor = new Date(rule.next_run_at as string);
  let guard = 0;
  while (cursor.getTime() <= nowMs && guard < 200) {
    due.push(cursor);
    const next = calcNextValidOccurrence(ruleForCalc, cursor, startAt, holidays);
    if (!next) return { due, following: null }; // esgotou tentativas (weekend_shift=skip sem saída)
    cursor = next;
    guard++;
  }
  return { due, following: cursor };
}

// Quais das ocorrências vencidas realmente devem ser criadas, conforme
// misfire_policy (seção 28 da issue).
function applyMisfirePolicy(due: Date[], policy: string): Date[] {
  if (due.length === 0) return [];
  if (policy === 'create_all_up_to_limit') return due.slice(-20); // teto de segurança
  if (policy === 'create_latest_only') return [due[due.length - 1]];
  // 'skip_past': só cria se está em dia (exatamente 1 vencida); se acumulou
  // atraso (cron parado por muito tempo), pula todas e só realinha o schedule.
  return due.length === 1 ? due : [];
}

// Issue #184 seção 21: "se o responsável original não estiver mais válido,
// definir fallback seguro e registrar log". Um usuário desativado (soft-delete,
// ver profiles.is_active) não pode continuar recebendo tarefas novas — a
// ocorrência nasce sem esse responsável em vez de referenciar alguém inválido.
async function filterActiveUserIds(admin: any, ids: (string | null | undefined)[]): Promise<Set<string>> {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  if (unique.length === 0) return new Set();
  const { data } = await admin.from('profiles').select('id').eq('is_active', true).in('id', unique);
  return new Set((data || []).map((p: { id: string }) => p.id));
}

function resolveAssignees(
  mainAssigneeId: string | null,
  secondaryAssigneeIds: string[] | null,
  activeIds: Set<string>,
  logContext: string,
): { mainAssigneeId: string | null; secondaryAssigneeIds: string[] } {
  let main = mainAssigneeId;
  if (main && !activeIds.has(main)) {
    console.error(`[task-recurrence-scheduler] ${logContext}: responsável principal ${main} inativo/removido — ocorrência criada sem responsável.`);
    main = null;
  }
  const secondary = (secondaryAssigneeIds || []).filter((id) => {
    if (activeIds.has(id)) return true;
    console.error(`[task-recurrence-scheduler] ${logContext}: responsável adicional ${id} inativo/removido — removido da nova ocorrência.`);
    return false;
  });
  return { mainAssigneeId: main, secondaryAssigneeIds: secondary };
}

async function fetchLatestOccurrenceTask(admin: any, rule: RuleRow) {
  if (rule.occurrences_created === 0) {
    const { data } = await admin.from('tasks').select('id,status').eq('id', rule.task_id).maybeSingle();
    return data;
  }
  const { data } = await admin
    .from('tasks')
    .select('id,status')
    .eq('recurrence_rule_id', rule.id)
    .order('recurrence_sequence', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

// Clona checklist items de uma tarefa pra outra. `keepCheckedState=false`
// (inherit.includeChecklistCheckedState) reseta tudo pra "não concluído" —
// a nova ocorrência começa do zero por padrão.
async function cloneChecklists(admin: any, fromTaskId: string, toTaskId: string, keepCheckedState: boolean) {
  const { data: src } = await admin.from('task_checklists').select('text,completed').eq('task_id', fromTaskId);
  if (!src || src.length === 0) return;
  await admin.from('task_checklists').insert(
    (src as { text: string; completed: boolean }[]).map((it) => ({
      task_id: toTaskId, text: it.text, completed: keepCheckedState ? it.completed : false,
    })),
  );
}

async function cloneCustomFields(admin: any, fromEntityId: string, toEntityId: string) {
  const { data: src } = await admin.from('custom_field_values').select('field_id,value').eq('entity_id', fromEntityId);
  if (!src || src.length === 0) return;
  await admin.from('custom_field_values').insert(
    (src as { field_id: string; value: unknown }[]).map((v) => ({ field_id: v.field_id, entity_id: toEntityId, value: v.value })),
  );
}

async function cloneWatchers(admin: any, fromTaskId: string, toTaskId: string) {
  const { data: src } = await admin.from('task_watchers').select('user_id').eq('task_id', fromTaskId);
  if (!src || src.length === 0) return;
  await admin.from('task_watchers').insert(
    (src as { user_id: string }[]).map((w) => ({ task_id: toTaskId, user_id: w.user_id })),
  );
}

// Preserva o offset da subtarefa em relação à tarefa-pai (issue #184 seção 8)
// — NÃO copia a data absoluta antiga. `anchorOriginal`/`anchorNew` são as
// datas (due_date preferencialmente, senão start_date) da tarefa-pai antes e
// depois da recorrência; se a subtarefa ou o pai não tiverem uma data de
// referência, a data correspondente da subtarefa fica null (evita "datas
// fantasma" erradas em vez de arriscar um remapeamento sem base).
function remapDate(dateStr: string | null, anchorOriginal: Date | null, anchorNew: Date | null): string | null {
  if (!dateStr || !anchorOriginal || !anchorNew) return null;
  const offsetMs = new Date(dateStr).getTime() - anchorOriginal.getTime();
  return new Date(anchorNew.getTime() + offsetMs).toISOString();
}

// Clona as subtarefas DIRETAS da tarefa-modelo pra nova ocorrência. Reaproveita
// as mesmas funções de clonagem de checklist/custom fields/watchers — não
// duplica a lógica de DuplicateTaskOptions (client-side), só espelha o mesmo
// conjunto de operações no contexto server-side do scheduler.
async function cloneSubtasks(
  admin: any,
  parentSourceId: string,
  parentNewId: string,
  listId: string,
  createdBy: string | null,
  inherit: Record<string, boolean>,
  anchorOriginal: Date | null,
  anchorNew: Date | null,
) {
  const { data: subtasks } = await admin
    .from('tasks')
    .select('id,title,description,priority,main_assignee_id,secondary_assignee_ids,start_date,due_date,tags,status')
    .eq('parent_id', parentSourceId);
  if (!subtasks || subtasks.length === 0) return;

  const activeIds = inherit.includeAssignees
    ? await filterActiveUserIds(admin, (subtasks as any[]).flatMap((s) => [s.main_assignee_id, ...(s.secondary_assignee_ids || [])]))
    : new Set<string>();

  for (const sub of subtasks as any[]) {
    const startDate = inherit.remapSubtaskDates ? remapDate(sub.start_date, anchorOriginal, anchorNew) : null;
    const dueDate = inherit.remapSubtaskDates ? remapDate(sub.due_date, anchorOriginal, anchorNew) : null;
    const assignees = inherit.includeAssignees
      ? resolveAssignees(sub.main_assignee_id, sub.secondary_assignee_ids, activeIds, `subtarefa ${sub.id}`)
      : { mainAssigneeId: null, secondaryAssigneeIds: [] };

    const { data: insertedSub, error: subErr } = await admin
      .from('tasks')
      .insert({
        title: sub.title,
        description: inherit.includeDescription ? sub.description : '',
        status: sub.status,
        priority: inherit.includePriority ? sub.priority : 'Media',
        main_assignee_id: assignees.mainAssigneeId,
        secondary_assignee_ids: assignees.secondaryAssigneeIds,
        start_date: startDate,
        due_date: dueDate,
        list_id: listId,
        parent_id: parentNewId,
        tags: inherit.includeTags ? (sub.tags || []) : [],
        created_by: createdBy,
      })
      .select('id')
      .single();
    if (subErr || !insertedSub) {
      console.error(`[task-recurrence-scheduler] falha ao clonar subtarefa ${sub.id}: ${subErr?.message}`);
      continue;
    }
    if (inherit.includeChecklists) await cloneChecklists(admin, sub.id, insertedSub.id, !!inherit.includeChecklistCheckedState);
    if (inherit.includeCustomFields) await cloneCustomFields(admin, sub.id, insertedSub.id);
    if (inherit.includeWatchers) await cloneWatchers(admin, sub.id, insertedSub.id);
  }
}

async function createOccurrenceTask(
  admin: any,
  rule: RuleRow,
  occurrenceAt: Date,
  sequence: number,
  flagOverlap: boolean,
) {
  const { data: template, error: templateErr } = await admin
    .from('tasks')
    .select('title,description,priority,main_assignee_id,secondary_assignee_ids,start_date,due_date,project_id,tags')
    .eq('id', rule.task_id)
    .single();
  if (templateErr || !template) return { error: templateErr?.message ?? 'Tarefa-modelo não encontrada.' };

  const { data: list } = await admin.from('lists').select('status_group_id').eq('id', rule.list_id).maybeSingle();
  let status = 'A fazer';
  if (list?.status_group_id) {
    const { data: firstOption } = await admin
      .from('task_status_options')
      .select('label')
      .eq('group_id', list.status_group_id)
      .order('order_index', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (firstOption?.label) status = firstOption.label;
  }

  const inherit = rule.inherit_options || {};
  let startDate: string | null = null;
  const dueDate = occurrenceAt.toISOString();
  if (template.start_date && template.due_date) {
    const durationMs = new Date(template.due_date).getTime() - new Date(template.start_date).getTime();
    startDate = new Date(occurrenceAt.getTime() - durationMs).toISOString();
  }

  const tags = inherit.includeTags ? (template.tags || []) : [];
  const finalTags = flagOverlap ? [...tags, 'recorrencia-sobreposta'] : tags;

  const templateAssignees = inherit.includeAssignees
    ? resolveAssignees(
        template.main_assignee_id,
        template.secondary_assignee_ids,
        await filterActiveUserIds(admin, [template.main_assignee_id, ...(template.secondary_assignee_ids || [])]),
        `tarefa-modelo ${rule.task_id}`,
      )
    : { mainAssigneeId: null, secondaryAssigneeIds: [] };

  const { data: inserted, error } = await admin
    .from('tasks')
    .insert({
      title: template.title,
      description: inherit.includeDescription ? template.description : '',
      status,
      priority: inherit.includePriority ? template.priority : 'Media',
      main_assignee_id: templateAssignees.mainAssigneeId,
      secondary_assignee_ids: templateAssignees.secondaryAssigneeIds,
      start_date: startDate,
      due_date: dueDate,
      list_id: rule.list_id,
      project_id: template.project_id,
      tags: finalTags,
      created_by: rule.created_by,
      recurrence_rule_id: rule.id,
      recurrence_parent_task_id: rule.task_id,
      recurrence_sequence: sequence,
      scheduled_occurrence_at: dueDate,
    })
    .select('id')
    .single();

  if (error) {
    if (error.code === '23505') return { alreadyExists: true };
    return { error: error.message };
  }

  if (inherit.includeChecklists) await cloneChecklists(admin, rule.task_id, inserted.id, !!inherit.includeChecklistCheckedState);
  if (inherit.includeCustomFields) await cloneCustomFields(admin, rule.task_id, inserted.id);
  if (inherit.includeWatchers) await cloneWatchers(admin, rule.task_id, inserted.id);
  if (inherit.includeSubtasks) {
    // Âncora do remapeamento (seção 8/9 da issue): due_date preferencialmente
    // (é a data que toda tarefa recorrente tem garantida), senão start_date.
    const anchorOriginal = template.due_date ? new Date(template.due_date) : (template.start_date ? new Date(template.start_date) : null);
    const anchorNew = dueDate ? new Date(dueDate) : (startDate ? new Date(startDate) : null);
    await cloneSubtasks(admin, rule.task_id, inserted.id, rule.list_id, rule.created_by, inherit, anchorOriginal, anchorNew);
  }

  // user_id é NOT NULL em task_activities — regra sem created_by (ex.: task
  // de import legado, sem criador) não gera esse registro de atividade,
  // mas isso não impede a criação da tarefa em si.
  if (rule.created_by) {
    await admin.from('task_activities').insert({
      task_id: inserted.id,
      user_id: rule.created_by,
      type: 'TASK_RECURRENCE_GENERATED',
      old_value: rule.task_id,
      new_value: template.title,
    });
  }
  return { taskId: inserted.id };
}

async function processRule(admin: any, rule: RuleRow, nowMs: number, holidays: ReadonlySet<string>) {
  const { due, following } = collectDueOccurrences(rule, nowMs, holidays);
  const toCreate = applyMisfirePolicy(due, rule.misfire_policy);

  const latest = await fetchLatestOccurrenceTask(admin, rule);
  const overlapping = latest ? !isDoneLikeStatus(latest.status) : false;

  let createdCount = 0;
  let occurrencesCreated = rule.occurrences_created;
  let disable = false;

  for (const occurrenceAt of toCreate) {
    // Condição de encerramento da série (seção 15/25 da issue).
    if (rule.end_mode === 'count' && rule.max_occurrences != null && occurrencesCreated >= rule.max_occurrences) {
      disable = true;
      break;
    }
    if (rule.end_mode === 'until' && rule.end_at && occurrenceAt.getTime() > new Date(rule.end_at).getTime()) {
      disable = true;
      break;
    }

    if (overlapping && rule.overlap_policy === 'postpone') {
      // Não avança o schedule nem cria — tenta de novo no próximo tick.
      return { created: 0, postponed: true };
    }
    if (overlapping && rule.overlap_policy === 'skip_new') {
      continue; // pula esta ocorrência, mas o schedule avança normalmente
    }

    const flagOverlap = overlapping && (rule.overlap_policy === 'create_and_flag' || rule.overlap_policy === 'escalate');
    const result = await createOccurrenceTask(admin, rule, occurrenceAt, occurrencesCreated + 1, flagOverlap);
    if ('error' in result) {
      console.error(`[task-recurrence-scheduler] regra ${rule.id}: ${result.error}`);
      continue;
    }
    if ('alreadyExists' in result) continue; // outra execução já criou (idempotência via unique index)

    occurrencesCreated += 1;
    createdCount += 1;

    if (overlapping && rule.overlap_policy === 'escalate' && rule.created_by) {
      await admin.from('notifications').insert({
        user_id: rule.created_by,
        actor_id: rule.created_by,
        type: 'recurrence_overlap',
        title: 'Nova ocorrência recorrente criada com a anterior ainda em aberto',
        body: '',
        task_id: (result as any).taskId,
      });
    }
  }

  return { created: createdCount, occurrencesCreated, following, disable };
}

Deno.serve(async (req: Request) => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(supabaseUrl, serviceRoleKey);

  const providedSecret = req.headers.get('x-scheduler-secret');
  if (!providedSecret) return json({ error: 'x-scheduler-secret ausente' }, 401);

  const { data: expectedSecret, error: secretErr } = await admin.rpc('get_recurrence_scheduler_secret');
  if (secretErr || !expectedSecret || providedSecret !== expectedSecret) {
    return json({ error: 'segredo inválido' }, 401);
  }

  const nowIso = new Date().toISOString();
  const nowMs = Date.now();

  // Claim atômico via FOR UPDATE SKIP LOCKED (issue #184 seção 20) — impede
  // que dois workers concorrentes (dois ticks do cron sobrepostos, ou um
  // retry) processem a mesma regra ao mesmo tempo. Regras cujo lock expirou
  // (worker anterior morreu sem liberar) voltam a ficar disponíveis depois
  // de p_lock_ttl_minutes.
  const { data: rules, error: rulesErr } = await admin.rpc('claim_due_recurrence_rules', { p_limit: 50, p_lock_ttl_minutes: 10 });

  if (rulesErr) return json({ error: rulesErr.message }, 500);
  if (!rules || rules.length === 0) return json({ processed: 0, created: 0 });

  // Calendário corporativo (issue #184 seção 11) — uma leitura por invocação,
  // reaproveitada por todas as regras processadas neste tick.
  const { data: holidayRows } = await admin.from('company_holidays').select('date');
  const holidays = new Set<string>((holidayRows || []).map((h: { date: string }) => h.date));

  let totalCreated = 0;
  let processed = 0;
  const errors: string[] = [];

  for (const rule of rules as RuleRow[]) {
    try {
      const result = await processRule(admin, rule, nowMs, holidays);
      processed += 1;
      if ('postponed' in result && result.postponed) {
        // Não avança next_run_at, mas libera o lock — sem isso a regra
        // ficaria travada até o TTL expirar em vez de ser reavaliada no
        // próximo tick (5 min).
        await admin.from('task_recurrence_rules').update({ locked_at: null }).eq('id', rule.id);
        continue;
      }

      totalCreated += result.created ?? 0;
      const update: Record<string, unknown> = {
        occurrences_created: result.occurrencesCreated ?? rule.occurrences_created,
        last_generated_at: (result.created ?? 0) > 0 ? nowIso : undefined,
        next_run_at: result.disable ? null : (result.following ? result.following.toISOString() : null),
        locked_at: null,
      };
      if (result.disable) update.enabled = false;
      // remove chaves undefined (Supabase JS não filtra sozinho)
      Object.keys(update).forEach((k) => update[k] === undefined && delete update[k]);

      await admin.from('task_recurrence_rules').update(update).eq('id', rule.id);
    } catch (e) {
      errors.push(`${rule.id}: ${e instanceof Error ? e.message : String(e)}`);
      // Libera o lock mesmo em erro — sem isso a regra fica presa até o TTL.
      await admin.from('task_recurrence_rules').update({ locked_at: null }).eq('id', rule.id);
    }
  }

  return json({ processed, created: totalCreated, errors });
});
