'use client';

import React, { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Download,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  XCircle,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';

type Policy = {
  id: string;
  cliente: string;
  empresa_segurada: string;
  tipo_seguro: string;
  seguradora: string;
  data_vencimento: string;
  premio: number;
  origem: string;
  observacoes: string;
  created_at?: string;
  updated_at?: string;
};

type PolicyForm = {
  cliente: string;
  empresa_segurada: string;
  tipo_seguro: string;
  seguradora: string;
  data_vencimento: string;
  premio: number;
  origem: string;
  observacoes: string;
};

type PolicyAlertLog = {
  id: string;
  policy_id: string;
  alert_type: string;
  sent_to?: string | null;
  recipient_email?: string | null;
  reference_date: string;
  created_at?: string | null;
  status?: string | null;
  error_message?: string | null;
  policy_name?: string | null;
};

type PolicyStatus = 'vencido' | 'vence_15' | 'vence_30' | 'vence_45' | 'ok';
type StatusFilter = 'todos' | PolicyStatus;

const MONTHS = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
];

const INSURANCE_TYPES = [
  'Responsabilidade Civil',
  'Vida',
  'Empresarial',
  'Patrimonial',
  'Auto',
  'Saúde',
  'D&O',
  'E&O',
  'Riscos de Engenharia',
  'Garantia',
  'Transportes',
  'Cyber',
  'Aeronáutico',
  'Marítimo',
  'Outros',
];

function emptyForm(): PolicyForm {
  return {
    cliente: '',
    empresa_segurada: '',
    tipo_seguro: 'Outros',
    seguradora: '',
    data_vencimento: '',
    premio: 0,
    origem: 'Manual',
    observacoes: '',
  };
}

function normalizeText(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(Number(value || 0));
}

function formatDate(value: string): string {
  if (!value) return '-';
  const parts = value.split('-');
  if (parts.length !== 3) return value;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function formatDateTimeBR(value?: string | null) {
  if (!value) return '-';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

function getMonthName(dateStr: string): string {
  if (!dateStr) return '';
  const date = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  return MONTHS[date.getMonth()] || '';
}

function getYear(dateStr: string): string {
  if (!dateStr) return '';
  const date = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  return String(date.getFullYear());
}

function parseMoney(value: unknown): number {
  const text = String(value ?? '')
    .replace(/R\$/gi, '')
    .replace(/\s+/g, '')
    .trim();

  if (!text) return 0;

  if (text.includes(',') && text.includes('.')) {
    return Number(text.replace(/\./g, '').replace(',', '.')) || 0;
  }

  if (text.includes(',')) {
    return Number(text.replace(',', '.')) || 0;
  }

  return Number(text) || 0;
}

function excelDateToISO(value: unknown): string {
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed?.y && parsed?.m && parsed?.d) {
      return `${String(parsed.y).padStart(4, '0')}-${String(parsed.m).padStart(
        2,
        '0'
      )}-${String(parsed.d).padStart(2, '0')}`;
    }
  }

  const text = normalizeText(value);
  if (!text) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

  const br = text.match(/^(\d{2})[\/.-](\d{2})[\/.-](\d{2,4})$/);
  if (!br) return '';

  let [, dd, mm, yyyy] = br;
  if (yyyy.length === 2) yyyy = `20${yyyy}`;
  return `${yyyy}-${mm}-${dd}`;
}

function downloadTemplate() {
  const rows = [
    {
      Cliente: '',
      'Empresa segurada': '',
      'Tipo de seguro': 'Outros',
      Seguradora: '',
      'Data de vencimento': '2026-12-31',
      Prêmio: 0,
      Origem: 'Excel',
      Observações: '',
    },
  ];

  const sheet = XLSX.utils.json_to_sheet(rows);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Apolices');
  XLSX.writeFile(book, 'template_importacao_apolices.xlsx');
}

function getTodayDateKey() {
  const now = new Date();
  return `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
}

function getDaysUntil(dateStr: string): number | null {
  if (!dateStr) return null;

  const hoje = new Date();
  const hojeZerado = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());

  const vencimento = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(vencimento.getTime())) return null;

  const vencimentoZerado = new Date(
    vencimento.getFullYear(),
    vencimento.getMonth(),
    vencimento.getDate()
  );

  const diffMs = vencimentoZerado.getTime() - hojeZerado.getTime();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

function getPolicyStatus(dateStr: string): PolicyStatus {
  const days = getDaysUntil(dateStr);

  if (days === null) return 'ok';
  if (days < 0) return 'vencido';
  if (days <= 15) return 'vence_15';
  if (days <= 30) return 'vence_30';
  if (days <= 45) return 'vence_45';
  return 'ok';
}

function getStatusLabel(dateStr: string): string {
  const days = getDaysUntil(dateStr);
  const status = getPolicyStatus(dateStr);

  if (days === null) return 'Sem vencimento';
  if (status === 'vencido') {
    return `Vencido há ${Math.abs(days)} dia${Math.abs(days) === 1 ? '' : 's'}`;
  }
  if (status === 'vence_15') {
    return days === 0 ? 'Vence hoje' : `Vence em ${days} dia${days === 1 ? '' : 's'}`;
  }
  if (status === 'vence_30') {
    return `Vence em ${days} dias`;
  }
  if (status === 'vence_45') {
    return `Vence em ${days} dias`;
  }
  return 'Em dia';
}

function getStatusClasses(status: PolicyStatus) {
  switch (status) {
    case 'vencido':
      return {
        card: 'border-red-500/40 bg-red-950/30',
        badge: 'bg-red-500/15 text-red-300 border border-red-500/30',
      };
    case 'vence_15':
      return {
        card: 'border-orange-500/40 bg-orange-950/20',
        badge: 'bg-orange-500/15 text-orange-300 border border-orange-500/30',
      };
    case 'vence_30':
      return {
        card: 'border-yellow-500/40 bg-yellow-950/20',
        badge: 'bg-yellow-500/15 text-yellow-300 border border-yellow-500/30',
      };
    case 'vence_45':
      return {
        card: 'border-sky-500/40 bg-sky-950/20',
        badge: 'bg-sky-500/15 text-sky-300 border border-sky-500/30',
      };
    default:
      return {
        card: 'border-emerald-500/30 bg-emerald-950/10',
        badge: 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30',
      };
  }
}

function getStatusIcon(status: PolicyStatus) {
  switch (status) {
    case 'vencido':
      return <XCircle className="h-4 w-4" />;
    case 'vence_15':
      return <AlertCircle className="h-4 w-4" />;
    case 'vence_30':
      return <Clock3 className="h-4 w-4" />;
    case 'vence_45':
      return <Clock3 className="h-4 w-4" />;
    default:
      return <CheckCircle2 className="h-4 w-4" />;
  }
}

function getAlertTypeLabel(alertType: string) {
  switch (alertType) {
    case 'vencido':
      return 'Vencido';
    case 'vence_15':
      return '15 dias';
    case 'vence_30':
      return '30 dias';
    case 'vence_45':
      return '45 dias';
    default:
      return alertType || '-';
  }
}

function getAlertStatusBadge(status?: string | null) {
  if (status === 'error') {
    return 'border border-red-500/30 bg-red-500/15 text-red-300';
  }

  return 'border border-emerald-500/30 bg-emerald-500/15 text-emerald-300';
}

export default function SistemaApolices() {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [alertLogs, setAlertLogs] = useState<PolicyAlertLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingLogs, setLoadingLogs] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [monthFilter, setMonthFilter] = useState('todos');
  const [yearFilter, setYearFilter] = useState('todos');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('todos');
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<PolicyForm>(emptyForm());
  const [importMessage, setImportMessage] = useState('');
  const [todayKey, setTodayKey] = useState(getTodayDateKey());

  async function loadPolicies() {
    setLoading(true);

    const { data, error } = await supabase
      .from('policies')
      .select('*')
      .order('data_vencimento', { ascending: true });

    if (error) {
      console.error('Erro ao carregar:', error);
      alert('Erro ao carregar dados do banco.');
      setLoading(false);
      return;
    }

    setPolicies((data || []) as Policy[]);
    setLoading(false);
  }

  async function loadAlertLogs() {
    setLoadingLogs(true);

    const { data, error } = await supabase
      .from('policy_alert_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) {
      console.error('Erro ao carregar histórico de alertas:', error);
      setLoadingLogs(false);
      return;
    }

    setAlertLogs((data || []) as PolicyAlertLog[]);
    setLoadingLogs(false);
  }

  useEffect(() => {
    loadPolicies();
    loadAlertLogs();
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setTodayKey(getTodayDateKey());
    }, 60000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const onFocus = () => setTodayKey(getTodayDateKey());
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  const availableYears = useMemo(() => {
    return [...new Set(policies.map((item) => getYear(item.data_vencimento)).filter(Boolean))].sort();
  }, [policies]);

  const policiesMap = useMemo(() => {
    return new Map(policies.map((policy) => [policy.id, policy]));
  }, [policies]);

  const policiesWithStatus = useMemo(() => {
    void todayKey;

    return policies.map((item) => {
      const status = getPolicyStatus(item.data_vencimento);
      const diasParaVencer = getDaysUntil(item.data_vencimento);

      return {
        ...item,
        status,
        diasParaVencer,
        statusLabel: getStatusLabel(item.data_vencimento),
      };
    });
  }, [policies, todayKey]);

  const counters = useMemo(() => {
    return {
      vencido: policiesWithStatus.filter((item) => item.status === 'vencido').length,
      vence_15: policiesWithStatus.filter((item) => item.status === 'vence_15').length,
      vence_30: policiesWithStatus.filter((item) => item.status === 'vence_30').length,
      vence_45: policiesWithStatus.filter((item) => item.status === 'vence_45').length,
      ok: policiesWithStatus.filter((item) => item.status === 'ok').length,
    };
  }, [policiesWithStatus]);

  const filteredPolicies = useMemo(() => {
    const filtered = policiesWithStatus.filter((item) => {
      const haystack = [
        item.cliente,
        item.empresa_segurada,
        item.tipo_seguro,
        item.seguradora,
        item.origem,
        item.observacoes,
        item.statusLabel,
      ]
        .join(' ')
        .toLowerCase();

      const matchesSearch = haystack.includes(search.toLowerCase());
      const matchesMonth =
        monthFilter === 'todos' || getMonthName(item.data_vencimento) === monthFilter;
      const matchesYear =
        yearFilter === 'todos' || getYear(item.data_vencimento) === yearFilter;
      const matchesStatus =
        statusFilter === 'todos' || item.status === statusFilter;

      return matchesSearch && matchesMonth && matchesYear && matchesStatus;
    });

    const orderMap: Record<PolicyStatus, number> = {
      vencido: 0,
      vence_15: 1,
      vence_30: 2,
      vence_45: 3,
      ok: 4,
    };

    return filtered.sort((a, b) => {
      const first = orderMap[a.status] - orderMap[b.status];
      if (first !== 0) return first;

      const dateA = a.data_vencimento ? new Date(`${a.data_vencimento}T12:00:00`).getTime() : Infinity;
      const dateB = b.data_vencimento ? new Date(`${b.data_vencimento}T12:00:00`).getTime() : Infinity;
      return dateA - dateB;
    });
  }, [policiesWithStatus, search, monthFilter, yearFilter, statusFilter]);

  function openNewModal() {
    setEditingId(null);
    setForm(emptyForm());
    setShowModal(true);
  }

  function openEditModal(policy: Policy) {
    setEditingId(policy.id);
    setForm({
      cliente: policy.cliente || '',
      empresa_segurada: policy.empresa_segurada || '',
      tipo_seguro: policy.tipo_seguro || 'Outros',
      seguradora: policy.seguradora || '',
      data_vencimento: policy.data_vencimento || '',
      premio: Number(policy.premio || 0),
      origem: policy.origem || 'Manual',
      observacoes: policy.observacoes || '',
    });
    setShowModal(true);
  }

  function handleChange(field: keyof PolicyForm, value: string | number) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function handleCardFilter(filter: StatusFilter) {
    setStatusFilter((current) => (current === filter ? 'todos' : filter));
  }

  function clearAllFilters() {
    setSearch('');
    setMonthFilter('todos');
    setYearFilter('todos');
    setStatusFilter('todos');
  }

  async function handleSave() {
    const payload = {
      cliente: normalizeText(form.cliente),
      empresa_segurada: normalizeText(form.empresa_segurada),
      tipo_seguro: normalizeText(form.tipo_seguro) || 'Outros',
      seguradora: normalizeText(form.seguradora),
      data_vencimento: form.data_vencimento,
      premio: Number(form.premio || 0),
      origem: normalizeText(form.origem) || 'Manual',
      observacoes: normalizeText(form.observacoes),
      updated_at: new Date().toISOString(),
    };

    setSaving(true);

    if (editingId) {
      const { error } = await supabase
        .from('policies')
        .update(payload)
        .eq('id', editingId);

      if (error) {
        console.error('Erro ao editar:', error);
        alert('Erro ao editar apólice.');
        setSaving(false);
        return;
      }
    } else {
      const { error } = await supabase.from('policies').insert(payload);

      if (error) {
        console.error('Erro ao inserir:', error);
        alert('Erro ao salvar apólice.');
        setSaving(false);
        return;
      }
    }

    setShowModal(false);
    setEditingId(null);
    setForm(emptyForm());
    setSaving(false);
    await loadPolicies();
    await loadAlertLogs();
  }

  async function handleDelete(id: string) {
    if (!window.confirm('Deseja remover esta apólice?')) return;

    const { error } = await supabase.from('policies').delete().eq('id', id);

    if (error) {
      console.error('Erro ao remover:', error);
      alert('Erro ao remover apólice.');
      return;
    }

    await loadPolicies();
    await loadAlertLogs();
  }

  async function handleExcelUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;

    const imported: Omit<Policy, 'id'>[] = [];
    const failed: string[] = [];

    for (const file of files) {
      try {
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[firstSheetName];
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
          defval: '',
        });

        rows.forEach((row) => {
          imported.push({
            cliente: normalizeText(row['Cliente'] ?? row['cliente'] ?? ''),
            empresa_segurada: normalizeText(
              row['Empresa segurada'] ??
                row['Empresa Segurada'] ??
                row['empresa_segurada'] ??
                ''
            ),
            tipo_seguro:
              normalizeText(
                row['Tipo de seguro'] ??
                  row['Tipo de Seguro'] ??
                  row['tipo_seguro'] ??
                  'Outros'
              ) || 'Outros',
            seguradora: normalizeText(
              row['Seguradora atual'] ??
                row['Seguradora Atual'] ??
                row['Seguradora'] ??
                row['seguradora'] ??
                ''
            ),
            data_vencimento: excelDateToISO(
              row['Data de vencimento'] ??
                row['Data de Vencimento'] ??
                row['Vencimento'] ??
                row['data_vencimento'] ??
                ''
            ),
            premio: parseMoney(row['Prêmio'] ?? row['Premio'] ?? row['premio'] ?? 0),
            origem: normalizeText(row['Origem'] ?? row['origem'] ?? 'Excel') || 'Excel',
            observacoes: normalizeText(
              row['Observações'] ?? row['Observacoes'] ?? row['observacoes'] ?? ''
            ),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
        });
      } catch (error) {
        console.error(error);
        failed.push(file.name);
      }
    }

    if (imported.length) {
      const { error } = await supabase.from('policies').insert(imported);

      if (error) {
        console.error('Erro ao importar:', error);
        alert('Erro ao importar Excel.');
        return;
      }

      await loadPolicies();
      await loadAlertLogs();
    }

    const messages: string[] = [];
    if (imported.length) messages.push(`${imported.length} registro(s) importado(s)`);
    if (failed.length) messages.push(`${failed.length} arquivo(s) com erro`);
    setImportMessage(messages.join(' • '));

    event.target.value = '';
  }

  function exportCSV(data: Policy[]) {
    const headers = [
      'Cliente',
      'Empresa segurada',
      'Tipo de seguro',
      'Seguradora',
      'Data de vencimento',
      'Prêmio',
      'Origem',
      'Observações',
    ];

    const rows = data.map((item) => [
      item.cliente,
      item.empresa_segurada,
      item.tipo_seguro,
      item.seguradora,
      item.data_vencimento,
      String(item.premio),
      item.origem,
      item.observacoes,
    ]);

    const csv = [headers, ...rows]
      .map((row) =>
        row.map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(';')
      )
      .join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'controle_seguros.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  const statusCardBase =
    'rounded-3xl border p-5 text-left transition hover:scale-[1.01] hover:shadow-lg';
  const statusCardActive = 'ring-2 ring-white/70';

  return (
    <div className="min-h-screen bg-[#0b0b0d] p-4 text-zinc-100 md:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-zinc-100">
              Sistema de Acompanhamento de Seguros
            </h1>
            <p className="mt-1 text-sm text-zinc-400">
              Agora com alerta visual de vencimento.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              className="inline-flex items-center rounded-2xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium"
              onClick={() => exportCSV(filteredPolicies)}
            >
              <Download className="mr-2 h-4 w-4" />
              Exportar CSV
            </button>

            <button
              className="inline-flex items-center rounded-2xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium"
              onClick={downloadTemplate}
            >
              <Download className="mr-2 h-4 w-4" />
              Baixar modelo Excel
            </button>

            <label className="inline-flex cursor-pointer items-center rounded-2xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium">
              <Upload className="mr-2 h-4 w-4" />
              Importar Excel
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                multiple
                className="hidden"
                onChange={handleExcelUpload}
              />
            </label>

            <button
              className="inline-flex items-center rounded-2xl bg-white px-4 py-2 text-sm font-medium text-black"
              onClick={openNewModal}
            >
              <Plus className="mr-2 h-4 w-4" />
              Nova apólice
            </button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <button
            type="button"
            onClick={() => handleCardFilter('vencido')}
            className={`${statusCardBase} border-red-500/30 bg-red-950/20 ${
              statusFilter === 'vencido' ? statusCardActive : ''
            }`}
          >
            <div className="flex items-center justify-between">
              <p className="text-sm text-red-300">Vencidos</p>
              <XCircle className="h-5 w-5 text-red-300" />
            </div>
            <p className="mt-2 text-3xl font-bold text-white">{counters.vencido}</p>
          </button>

          <button
            type="button"
            onClick={() => handleCardFilter('vence_15')}
            className={`${statusCardBase} border-orange-500/30 bg-orange-950/20 ${
              statusFilter === 'vence_15' ? statusCardActive : ''
            }`}
          >
            <div className="flex items-center justify-between">
              <p className="text-sm text-orange-300">Até 15 dias</p>
              <AlertCircle className="h-5 w-5 text-orange-300" />
            </div>
            <p className="mt-2 text-3xl font-bold text-white">{counters.vence_15}</p>
          </button>

          <button
            type="button"
            onClick={() => handleCardFilter('vence_30')}
            className={`${statusCardBase} border-yellow-500/30 bg-yellow-950/20 ${
              statusFilter === 'vence_30' ? statusCardActive : ''
            }`}
          >
            <div className="flex items-center justify-between">
              <p className="text-sm text-yellow-300">Até 30 dias</p>
              <Clock3 className="h-5 w-5 text-yellow-300" />
            </div>
            <p className="mt-2 text-3xl font-bold text-white">{counters.vence_30}</p>
          </button>

          <button
            type="button"
            onClick={() => handleCardFilter('vence_45')}
            className={`${statusCardBase} border-sky-500/30 bg-sky-950/20 ${
              statusFilter === 'vence_45' ? statusCardActive : ''
            }`}
          >
            <div className="flex items-center justify-between">
              <p className="text-sm text-sky-300">Até 45 dias</p>
              <Clock3 className="h-5 w-5 text-sky-300" />
            </div>
            <p className="mt-2 text-3xl font-bold text-white">{counters.vence_45}</p>
          </button>

          <button
            type="button"
            onClick={() => handleCardFilter('ok')}
            className={`${statusCardBase} border-emerald-500/30 bg-emerald-950/20 ${
              statusFilter === 'ok' ? statusCardActive : ''
            }`}
          >
            <div className="flex items-center justify-between">
              <p className="text-sm text-emerald-300">Em dia</p>
              <CheckCircle2 className="h-5 w-5 text-emerald-300" />
            </div>
            <p className="mt-2 text-3xl font-bold text-white">{counters.ok}</p>
          </button>
        </div>

        {importMessage && (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-300">
            {importMessage}
          </div>
        )}

        <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1fr_220px_220px_220px_auto]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
              <input
                className="w-full rounded-2xl border border-zinc-800 bg-zinc-900 py-2 pl-9 pr-3 text-zinc-100 outline-none"
                placeholder="Buscar por cliente, empresa, seguradora, tipo, origem ou observação"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <select
              className="rounded-2xl border border-zinc-800 bg-zinc-900 px-3 py-2 outline-none"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            >
              <option value="todos">Todos os status</option>
              <option value="vencido">Vencidos</option>
              <option value="vence_15">Até 15 dias</option>
              <option value="vence_30">Até 30 dias</option>
              <option value="vence_45">Até 45 dias</option>
              <option value="ok">Em dia</option>
            </select>

            <select
              className="rounded-2xl border border-zinc-800 bg-zinc-900 px-3 py-2 outline-none"
              value={yearFilter}
              onChange={(e) => setYearFilter(e.target.value)}
            >
              <option value="todos">Todos os anos</option>
              {availableYears.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>

            <select
              className="rounded-2xl border border-zinc-800 bg-zinc-900 px-3 py-2 outline-none"
              value={monthFilter}
              onChange={(e) => setMonthFilter(e.target.value)}
            >
              <option value="todos">Todos os meses</option>
              {MONTHS.map((month) => (
                <option key={month} value={month}>
                  {month}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={clearAllFilters}
              className="rounded-2xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium"
            >
              Limpar filtros
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-300">
          Exibindo <span className="font-semibold text-white">{filteredPolicies.length}</span> apólice(s)
          {statusFilter !== 'todos' && (
            <>
              {' '}
              com filtro de status <span className="font-semibold text-white">{statusFilter}</span>
            </>
          )}
          .
        </div>

        <div className="grid gap-4">
          {loading && (
            <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-10 text-center text-zinc-400">
              Carregando apólices...
            </div>
          )}

          {!loading && filteredPolicies.length === 0 && (
            <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-10 text-center text-zinc-400">
              Nenhuma apólice encontrada.
            </div>
          )}

          {!loading &&
            filteredPolicies.map((item) => {
              const style = getStatusClasses(item.status);

              return (
                <div
                  key={item.id}
                  className={`rounded-3xl border p-6 ${style.card}`}
                >
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center gap-3">
                        <h3 className="text-xl font-semibold text-zinc-100">
                          {item.empresa_segurada || '-'}
                        </h3>

                        <span
                          className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${style.badge}`}
                        >
                          {getStatusIcon(item.status)}
                          {item.statusLabel}
                        </span>
                      </div>

                      <div className="grid gap-3 text-sm text-zinc-300 md:grid-cols-2 xl:grid-cols-3">
                        <div>
                          Cliente:{' '}
                          <span className="font-medium text-zinc-100">
                            {item.cliente || '-'}
                          </span>
                        </div>

                        <div>
                          Tipo:{' '}
                          <span className="font-medium text-zinc-100">
                            {item.tipo_seguro || '-'}
                          </span>
                        </div>

                        <div>
                          Seguradora:{' '}
                          <span className="font-medium text-zinc-100">
                            {item.seguradora || '-'}
                          </span>
                        </div>

                        <div>
                          Vencimento:{' '}
                          <span className="font-medium text-zinc-100">
                            {formatDate(item.data_vencimento)}
                          </span>
                        </div>

                        <div>
                          Prêmio:{' '}
                          <span className="font-medium text-zinc-100">
                            {item.premio ? formatCurrency(item.premio) : '-'}
                          </span>
                        </div>

                        <div>
                          Origem:{' '}
                          <span className="font-medium text-zinc-100">
                            {item.origem || '-'}
                          </span>
                        </div>

                        <div>
                          Ano:{' '}
                          <span className="font-medium text-zinc-100">
                            {getYear(item.data_vencimento) || '-'}
                          </span>
                        </div>

                        <div>
                          Mês:{' '}
                          <span className="font-medium text-zinc-100">
                            {getMonthName(item.data_vencimento) || '-'}
                          </span>
                        </div>

                        <div>
                          Dias restantes:{' '}
                          <span className="font-medium text-zinc-100">
                            {item.diasParaVencer === null
                              ? '-'
                              : item.diasParaVencer < 0
                              ? `${Math.abs(item.diasParaVencer)} dia${Math.abs(item.diasParaVencer) === 1 ? '' : 's'} em atraso`
                              : `${item.diasParaVencer} dia${item.diasParaVencer === 1 ? '' : 's'}`}
                          </span>
                        </div>
                      </div>

                      {item.observacoes && (
                        <div className="rounded-2xl bg-zinc-900 px-4 py-3 text-sm text-zinc-300">
                          Observações: {item.observacoes}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        className="inline-flex items-center rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
                        onClick={() => openEditModal(item)}
                      >
                        <Pencil className="mr-2 h-4 w-4" />
                        Editar
                      </button>

                      <button
                        className="inline-flex items-center rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-red-300"
                        onClick={() => handleDelete(item.id)}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Remover
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
        </div>

        <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-white">Histórico de Alertas</h2>
              <p className="mt-1 text-sm text-zinc-400">
                Últimos alertas registrados pelo sistema.
              </p>
            </div>

            <button
              type="button"
              onClick={loadAlertLogs}
              className="inline-flex items-center rounded-2xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium"
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Atualizar histórico
            </button>
          </div>

          {loadingLogs ? (
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6 text-sm text-zinc-400">
              Carregando histórico...
            </div>
          ) : alertLogs.length === 0 ? (
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6 text-sm text-zinc-400">
              Nenhum alerta registrado ainda.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-zinc-800">
              <table className="min-w-full text-sm">
                <thead className="bg-zinc-900 text-left text-zinc-300">
                  <tr>
                    <th className="px-4 py-3">Data do log</th>
                    <th className="px-4 py-3">Referência</th>
                    <th className="px-4 py-3">Apólice</th>
                    <th className="px-4 py-3">Tipo</th>
                    <th className="px-4 py-3">Destinatário</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Erro</th>
                  </tr>
                </thead>

                <tbody>
                  {alertLogs.map((log) => {
                    const policy = policiesMap.get(log.policy_id);
                    const displayName =
                      policy?.empresa_segurada && policy?.cliente
                        ? `${policy.empresa_segurada} | Cliente: ${policy.cliente}`
                        : policy?.empresa_segurada ||
                          (policy?.cliente ? `Cliente: ${policy.cliente}` : log.policy_name || '-');

                    return (
                      <tr key={log.id} className="border-t border-zinc-800 bg-zinc-950 text-zinc-200">
                        <td className="px-4 py-3">{formatDateTimeBR(log.created_at)}</td>
                        <td className="px-4 py-3">{formatDate(log.reference_date)}</td>
                        <td className="px-4 py-3">{displayName}</td>
                        <td className="px-4 py-3">{getAlertTypeLabel(log.alert_type)}</td>
                        <td className="px-4 py-3">{log.recipient_email || log.sent_to || '-'}</td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${getAlertStatusBadge(
                              log.status
                            )}`}
                          >
                            {log.status === 'error' ? 'Erro' : 'Enviado'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-zinc-400">
                          {log.error_message || '-'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {showModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div className="w-full max-w-3xl rounded-3xl border border-zinc-800 bg-zinc-950 p-6 shadow-xl">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-xl font-semibold">
                  {editingId ? 'Editar apólice' : 'Cadastrar apólice'}
                </h2>
                <button
                  className="rounded-xl border border-zinc-700 px-3 py-1"
                  onClick={() => setShowModal(false)}
                >
                  Fechar
                </button>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Cliente</label>
                  <input
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2"
                    value={form.cliente}
                    onChange={(e) => handleChange('cliente', e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Empresa segurada</label>
                  <input
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2"
                    value={form.empresa_segurada}
                    onChange={(e) => handleChange('empresa_segurada', e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Tipo de seguro</label>
                  <select
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2"
                    value={form.tipo_seguro}
                    onChange={(e) => handleChange('tipo_seguro', e.target.value)}
                  >
                    {INSURANCE_TYPES.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Seguradora</label>
                  <input
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2"
                    value={form.seguradora}
                    onChange={(e) => handleChange('seguradora', e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Data de vencimento</label>
                  <input
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2"
                    type="date"
                    value={form.data_vencimento}
                    onChange={(e) => handleChange('data_vencimento', e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Prêmio</label>
                  <input
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2"
                    type="number"
                    value={form.premio}
                    onChange={(e) => handleChange('premio', Number(e.target.value))}
                  />
                </div>

                <div className="space-y-2 md:col-span-2">
                  <label className="text-sm font-medium">Origem</label>
                  <input
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2"
                    value={form.origem}
                    onChange={(e) => handleChange('origem', e.target.value)}
                  />
                </div>

                <div className="space-y-2 md:col-span-2">
                  <label className="text-sm font-medium">Observações</label>
                  <textarea
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2"
                    value={form.observacoes}
                    onChange={(e) => handleChange('observacoes', e.target.value)}
                  />
                </div>
              </div>

              <div className="mt-5 flex justify-end">
                <button
                  className="rounded-2xl bg-white px-4 py-2 text-black"
                  onClick={handleSave}
                  disabled={saving}
                >
                  {saving ? 'Salvando...' : editingId ? 'Salvar edição' : 'Salvar apólice'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}