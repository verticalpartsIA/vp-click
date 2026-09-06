// Calendário corporativo de feriados (issue #184, fase 4, seção 11) — fonte
// própria de "skip_holidays", nunca hardcoded. Leitura livre pra qualquer
// autenticado (RLS: company_holidays_select), escrita só is_manager()
// (RLS: company_holidays_write) — ver migration task_recurrence_phase4_holidays.
import { supabase } from './supabase';

export interface CompanyHoliday {
  id: string;
  date: string; // 'YYYY-MM-DD'
  name: string;
  createdBy?: string;
  createdAt: string;
}

interface HolidayRow {
  id: string;
  date: string;
  name: string;
  created_by: string | null;
  created_at: string;
}

function mapHolidayRow(r: HolidayRow): CompanyHoliday {
  return { id: r.id, date: r.date, name: r.name, createdBy: r.created_by ?? undefined, createdAt: r.created_at };
}

export async function fetchCompanyHolidays(): Promise<CompanyHoliday[]> {
  const { data, error } = await supabase.from('company_holidays').select('*').order('date', { ascending: true });
  if (error || !data) return [];
  return (data as HolidayRow[]).map(mapHolidayRow);
}

export async function addCompanyHoliday(date: string, name: string, createdBy: string): Promise<{ holiday: CompanyHoliday } | { error: string }> {
  const { data, error } = await supabase
    .from('company_holidays')
    .insert({ date, name: name.trim(), created_by: createdBy })
    .select('*')
    .single();
  if (error || !data) return { error: error?.message ?? 'Falha ao criar feriado.' };
  return { holiday: mapHolidayRow(data as HolidayRow) };
}

export async function deleteCompanyHoliday(id: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('company_holidays').delete().eq('id', id);
  return { error: error?.message ?? null };
}
