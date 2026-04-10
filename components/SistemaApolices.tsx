'use client';

import React, { ChangeEvent, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';

type Policy = {
  id: string;
  cliente: string;
  empresa_segurada: string;
  tipo_seguro: string;
  seguradora: string;
  data_vencimento: string;
  premio: number | null;
  origem: string | null;
  observacoes: string | null;
  pdf_url: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type AlertLog = {
  id: string;
  policy_id?: string | null;
  alert_type?: string | null;
  recipient_email?: string | null;
  sent_to?: string | null;
  reference_date?: string | null;
  created_at?: string | null;
  status?: string | null;
  error_message?: string | null;
  policy_label?: string | null;
};

type FormState = {
  cliente: string;
  empresa_segurada: string;
  tipo_seguro: string;
  seguradora: string;
  data_vencimento: string;
  premio: string;
  origem: string;
  observacoes: string;
};

const emptyForm: FormState = {
  cliente: '',
  empresa_segurada: '',
  tipo_seguro: '',
  seguradora: '',
  data_vencimento: '',
  premio: '',
  origem: 'Manual',
  observacoes: '',
};

function formatCurrency(value: number | null | undefined) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(Number(value || 0));
}

function formatDate(date: string | null | undefined) {
  if (!date) return '-';
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('pt-BR');
}

function formatDateTime(date: string | null | undefined) {
  if (!date) return '-';
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('pt-BR');
}

function getDaysRemaining(date: string) {
  const today = new Date();
  const target = new Date(`${date}T00:00:00`);

  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);

  const diffMs = target.getTime() - today.getTime();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

function getPolicyStatus(date: string) {
  const days = getDaysRemaining(date);

  if (days < 0) {
    return {
      key: 'vencido',
      label: `Vencido há ${Math.abs(days)} dia${Math.abs(days) === 1 ? '' : 's'}`,
      color: 'border-red-500/40 bg-red-950/40 text-red-200',
    };
  }

  if (days <= 15) {
    return {
      key: 'ate15',
      label: `Vence em ${days} dia${days === 1 ? '' : 's'}`,
      color: 'border-orange-500/40 bg-orange-950/40 text-orange-200',
    };
  }

  if (days <= 30) {
    return {
      key: 'ate30',
      label: `Vence em ${days} dia${days === 1 ? '' : 's'}`,
      color: 'border-amber-500/40 bg-amber-950/40 text-amber-200',
    };
  }

  if (days <= 45) {
    return {
      key: 'ate45',
      label: `Vence em ${days} dia${days === 1 ? '' : 's'}`,
      color: 'border-sky-500/40 bg-sky-950/40 text-sky-200',
    };
  }

  return {
    key: 'emdia',
    label: 'Em dia',
    color: 'border-emerald-500/40 bg-emerald-950/40 text-emerald-200',
  };
}

export default function SistemaApolices() {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [alertLogs, setAlertLogs] = useState<AlertLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingLogs, setLoadingLogs] = useState(true);
  const [openModal, setOpenModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedPdf, setSelectedPdf] = useState<File | null>(null);
  const [removingPdf, setRemovingPdf] = useState(false);

  const [form, setForm] = useState<FormState>(emptyForm);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('todos');
  const [yearFilter, setYearFilter] = useState('todos');
  const [monthFilter, setMonthFilter] = useState('todos');
  const [historySearch, setHistorySearch] = useState('');

  useEffect(() => {
    loadPolicies();
    loadAlertLogs();
  }, []);

  async function loadPolicies() {
    try {
      setLoading(true);

      const { data, error } = await supabase
        .from('policies')
        .select('*')
        .order('data_vencimento', { ascending: true });

      if (error) throw error;

      setPolicies((data || []) as Policy[]);
    } catch (error) {
      console.error('Erro ao carregar apólices:', error);
      alert('Erro ao carregar apólices.');
    } finally {
      setLoading(false);
    }
  }

  async function loadAlertLogs() {
    try {
      setLoadingLogs(true);

      const { data, error } = await supabase
        .from('policy_alert_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(30);

      if (error) {
        console.warn('Erro ao carregar histórico:', error.message);
        setAlertLogs([]);
        return;
      }

      setAlertLogs((data || []) as AlertLog[]);
    } catch (error) {
      console.warn('Erro ao carregar histórico:', error);
      setAlertLogs([]);
    } finally {
      setLoadingLogs(false);
    }
  }

  const years = useMemo(() => {
    const values = Array.from(
      new Set(
        policies
          .map((policy) => {
            if (!policy.data_vencimento) return null;
            return new Date(`${policy.data_vencimento}T00:00:00`).getFullYear();
          })
          .filter(Boolean)
      )
    ) as number[];

    return values.sort((a, b) => a - b);
  }, [policies]);

  const filteredPolicies = useMemo(() => {
    return policies.filter((policy) => {
      const text = [
        policy.cliente,
        policy.empresa_segurada,
        policy.seguradora,
        policy.tipo_seguro,
        policy.origem,
        policy.observacoes,
      ]
        .join(' ')
        .toLowerCase();

      const matchesSearch = text.includes(search.toLowerCase());

      const status = getPolicyStatus(policy.data_vencimento).key;
      const matchesStatus = statusFilter === 'todos' || statusFilter === status;

      const policyDate = new Date(`${policy.data_vencimento}T00:00:00`);
      const policyYear = String(policyDate.getFullYear());
      const policyMonth = String(policyDate.getMonth() + 1).padStart(2, '0');

      const matchesYear = yearFilter === 'todos' || yearFilter === policyYear;
      const matchesMonth = monthFilter === 'todos' || monthFilter === policyMonth;

      return matchesSearch && matchesStatus && matchesYear && matchesMonth;
    });
  }, [policies, search, statusFilter, yearFilter, monthFilter]);

  const filteredAlertLogs = useMemo(() => {
    return alertLogs.filter((log) => {
      const text = [
        log.policy_label,
        log.alert_type,
        log.recipient_email,
        log.sent_to,
        log.status,
        log.error_message,
      ]
        .join(' ')
        .toLowerCase();

      return text.includes(historySearch.toLowerCase());
    });
  }, [alertLogs, historySearch]);

  const stats = useMemo(() => {
    const result = {
      vencido: 0,
      ate15: 0,
      ate30: 0,
      ate45: 0,
      emdia: 0,
    };

    policies.forEach((policy) => {
      const status = getPolicyStatus(policy.data_vencimento).key as keyof typeof result;
      result[status] += 1;
    });

    return result;
  }, [policies]);

  function resetForm() {
    setForm(emptyForm);
    setEditingId(null);
    setSelectedPdf(null);
    setOpenModal(false);
  }

  function handleOpenNew() {
    setForm(emptyForm);
    setEditingId(null);
    setSelectedPdf(null);
    setOpenModal(true);
  }

  function handleEdit(policy: Policy) {
    setEditingId(policy.id);
    setForm({
      cliente: policy.cliente || '',
      empresa_segurada: policy.empresa_segurada || '',
      tipo_seguro: policy.tipo_seguro || '',
      seguradora: policy.seguradora || '',
      data_vencimento: policy.data_vencimento || '',
      premio: policy.premio != null ? String(policy.premio) : '',
      origem: policy.origem || 'Manual',
      observacoes: policy.observacoes || '',
    });
    setSelectedPdf(null);
    setOpenModal(true);
  }

  function handleChange<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function uploadPdf(file: File, policyId: string) {
    const extension = file.name.split('.').pop() || 'pdf';
    const path = `apolices/${policyId}-${Date.now()}.${extension}`;

    const { error: uploadError } = await supabase.storage
      .from('apolices-pdf')
      .upload(path, file, {
        upsert: true,
        contentType: 'application/pdf',
      });

    if (uploadError) throw uploadError;

    const { data } = supabase.storage.from('apolices-pdf').getPublicUrl(path);
    return data.publicUrl;
  }

  async function handleSave() {
    if (!form.cliente || !form.empresa_segurada || !form.tipo_seguro || !form.seguradora || !form.data_vencimento) {
      alert('Preencha os campos obrigatórios.');
      return;
    }

    try {
      setSaving(true);

      let policyId = editingId;

      if (editingId) {
        const { error } = await supabase
          .from('policies')
          .update({
            cliente: form.cliente,
            empresa_segurada: form.empresa_segurada,
            tipo_seguro: form.tipo_seguro,
            seguradora: form.seguradora,
            data_vencimento: form.data_vencimento,
            premio: form.premio ? Number(form.premio.replace(',', '.')) : 0,
            origem: form.origem,
            observacoes: form.observacoes,
            updated_at: new Date().toISOString(),
          })
          .eq('id', editingId);

        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from('policies')
          .insert({
            cliente: form.cliente,
            empresa_segurada: form.empresa_segurada,
            tipo_seguro: form.tipo_seguro,
            seguradora: form.seguradora,
            data_vencimento: form.data_vencimento,
            premio: form.premio ? Number(form.premio.replace(',', '.')) : 0,
            origem: form.origem,
            observacoes: form.observacoes,
          })
          .select()
          .single();

        if (error) throw error;
        policyId = data.id;
      }

      if (selectedPdf && policyId) {
        const pdfUrl = await uploadPdf(selectedPdf, policyId);

        const { error: pdfError } = await supabase
          .from('policies')
          .update({
            pdf_url: pdfUrl,
            updated_at: new Date().toISOString(),
          })
          .eq('id', policyId);

        if (pdfError) throw pdfError;
      }

      await loadPolicies();
      resetForm();
    } catch (error) {
      console.error('Erro ao salvar apólice:', error);
      alert('Erro ao salvar apólice.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    const confirmed = window.confirm('Tem certeza que deseja remover esta apólice?');
    if (!confirmed) return;

    try {
      const { error } = await supabase.from('policies').delete().eq('id', id);
      if (error) throw error;

      await loadPolicies();
      await loadAlertLogs();
    } catch (error) {
      console.error('Erro ao remover apólice:', error);
      alert('Erro ao remover apólice.');
    }
  }

  async function handleRemovePdf(policyId: string) {
    const confirmed = window.confirm('Deseja remover o PDF desta apólice?');
    if (!confirmed) return;

    try {
      setRemovingPdf(true);

      const { error } = await supabase
        .from('policies')
        .update({
          pdf_url: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', policyId);

      if (error) throw error;

      await loadPolicies();

      if (editingId === policyId) {
        setSelectedPdf(null);
      }
    } catch (error) {
      console.error('Erro ao remover PDF:', error);
      alert('Erro ao remover PDF.');
    } finally {
      setRemovingPdf(false);
    }
  }

  function exportCsv() {
    const headers = [
      'cliente',
      'empresa_segurada',
      'tipo_seguro',
      'seguradora',
      'data_vencimento',
      'premio',
      'origem',
      'observacoes',
      'pdf_url',
    ];

    const rows = policies.map((policy) =>
      [
        policy.cliente,
        policy.empresa_segurada,
        policy.tipo_seguro,
        policy.seguradora,
        policy.data_vencimento,
        policy.premio ?? '',
        policy.origem ?? '',
        policy.observacoes ?? '',
        policy.pdf_url ?? '',
      ]
        .map((value) => `"${String(value).replace(/"/g, '""')}"`)
        .join(';')
    );

    const csv = [headers.join(';'), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = 'apolices.csv';
    a.click();

    URL.revokeObjectURL(url);
  }

  function downloadModelCsv() {
    const headers = [
      'cliente',
      'empresa_segurada',
      'tipo_seguro',
      'seguradora',
      'data_vencimento',
      'premio',
      'origem',
      'observacoes',
    ];

    const example = [
      'MDL COMEX',
      'MDL COMEX',
      'Seguro auto',
      'PORTO SEGURO',
      '2026-11-21',
      '16864.16',
      'Manual',
      'contato',
    ];

    const csv = [headers.join(';'), example.join(';')].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = 'modelo-apolices.csv';
    a.click();

    URL.revokeObjectURL(url);
  }

  async function handleImportCsv(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).filter(Boolean);

      if (lines.length < 2) {
        alert('Arquivo vazio ou inválido.');
        return;
      }

      const headers = lines[0].split(';').map((h) => h.trim().replace(/"/g, ''));

      const imported = lines.slice(1).map((line) => {
        const cols = line.split(';').map((c) => c.trim().replace(/^"|"$/g, ''));
        const obj: Record<string, string> = {};
        headers.forEach((header, index) => {
          obj[header] = cols[index] || '';
        });
        return obj;
      });

      const payload = imported.map((row) => ({
        cliente: row.cliente || '',
        empresa_segurada: row.empresa_segurada || row.cliente || '',
        tipo_seguro: row.tipo_seguro || '',
        seguradora: row.seguradora || '',
        data_vencimento: row.data_vencimento || '',
        premio: row.premio ? Number(String(row.premio).replace(',', '.')) : 0,
        origem: row.origem || 'Importado CSV',
        observacoes: row.observacoes || '',
      }));

      const { error } = await supabase.from('policies').insert(payload);
      if (error) throw error;

      await loadPolicies();
      alert('Importação concluída.');
    } catch (error) {
      console.error('Erro ao importar CSV:', error);
      alert('Erro ao importar arquivo.');
    } finally {
      event.target.value = '';
    }
  }

  const activeEditingPolicy = editingId
    ? policies.find((policy) => policy.id === editingId) || null
    : null;

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-7xl px-4 py-8">
        <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="text-4xl font-bold tracking-tight">
              Sistema de Acompanhamento de Seguros
            </h1>
            <p className="mt-2 text-zinc-400">
              Agora com alerta visual de vencimento e anexo de PDF da apólice.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              onClick={exportCsv}
              className="rounded-2xl border border-white/10 bg-zinc-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-zinc-800"
            >
              Exportar CSV
            </button>

            <button
              onClick={downloadModelCsv}
              className="rounded-2xl border border-white/10 bg-zinc-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-zinc-800"
            >
              Baixar modelo Excel
            </button>

            <label className="cursor-pointer rounded-2xl border border-white/10 bg-zinc-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-zinc-800">
              Importar Excel
              <input
                type="file"
                accept=".csv"
                className="hidden"
                onChange={handleImportCsv}
              />
            </label>

            <button
              onClick={handleOpenNew}
              className="rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-black transition hover:opacity-90"
            >
              + Nova apólice
            </button>
          </div>
        </div>

        <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <button
            onClick={() => setStatusFilter('vencido')}
            className="rounded-3xl border border-red-500/30 bg-red-950/30 p-5 text-left transition hover:bg-red-950/50"
          >
            <div className="text-sm text-red-200">Vencidos</div>
            <div className="mt-2 text-5xl font-bold">{stats.vencido}</div>
          </button>

          <button
            onClick={() => setStatusFilter('ate15')}
            className="rounded-3xl border border-orange-500/30 bg-orange-950/30 p-5 text-left transition hover:bg-orange-950/50"
          >
            <div className="text-sm text-orange-200">Até 15 dias</div>
            <div className="mt-2 text-5xl font-bold">{stats.ate15}</div>
          </button>

          <button
            onClick={() => setStatusFilter('ate30')}
            className="rounded-3xl border border-amber-500/30 bg-amber-950/30 p-5 text-left transition hover:bg-amber-950/50"
          >
            <div className="text-sm text-amber-200">Até 30 dias</div>
            <div className="mt-2 text-5xl font-bold">{stats.ate30}</div>
          </button>

          <button
            onClick={() => setStatusFilter('ate45')}
            className="rounded-3xl border border-sky-500/30 bg-sky-950/30 p-5 text-left transition hover:bg-sky-950/50"
          >
            <div className="text-sm text-sky-200">Até 45 dias</div>
            <div className="mt-2 text-5xl font-bold">{stats.ate45}</div>
          </button>

          <button
            onClick={() => setStatusFilter('emdia')}
            className="rounded-3xl border border-emerald-500/30 bg-emerald-950/30 p-5 text-left transition hover:bg-emerald-950/50"
          >
            <div className="text-sm text-emerald-200">Em dia</div>
            <div className="mt-2 text-5xl font-bold">{stats.emdia}</div>
          </button>
        </div>

        <div className="mb-6 rounded-3xl border border-white/10 bg-zinc-950 p-4">
          <div className="grid gap-3 lg:grid-cols-[2fr_1fr_1fr_1fr_auto]">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por cliente, empresa, seguradora, tipo, origem ou observação"
              className="rounded-2xl border border-white/10 bg-zinc-900 px-4 py-3 text-white outline-none placeholder:text-zinc-500"
            />

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-2xl border border-white/10 bg-zinc-900 px-4 py-3 text-white outline-none"
            >
              <option value="todos">Todos os status</option>
              <option value="vencido">Vencidos</option>
              <option value="ate15">Até 15 dias</option>
              <option value="ate30">Até 30 dias</option>
              <option value="ate45">Até 45 dias</option>
              <option value="emdia">Em dia</option>
            </select>

            <select
              value={yearFilter}
              onChange={(e) => setYearFilter(e.target.value)}
              className="rounded-2xl border border-white/10 bg-zinc-900 px-4 py-3 text-white outline-none"
            >
              <option value="todos">Todos os anos</option>
              {years.map((year) => (
                <option key={year} value={String(year)}>
                  {year}
                </option>
              ))}
            </select>

            <select
              value={monthFilter}
              onChange={(e) => setMonthFilter(e.target.value)}
              className="rounded-2xl border border-white/10 bg-zinc-900 px-4 py-3 text-white outline-none"
            >
              <option value="todos">Todos os meses</option>
              <option value="01">Janeiro</option>
              <option value="02">Fevereiro</option>
              <option value="03">Março</option>
              <option value="04">Abril</option>
              <option value="05">Maio</option>
              <option value="06">Junho</option>
              <option value="07">Julho</option>
              <option value="08">Agosto</option>
              <option value="09">Setembro</option>
              <option value="10">Outubro</option>
              <option value="11">Novembro</option>
              <option value="12">Dezembro</option>
            </select>

            <button
              onClick={() => {
                setSearch('');
                setStatusFilter('todos');
                setYearFilter('todos');
                setMonthFilter('todos');
              }}
              className="rounded-2xl border border-white/10 bg-zinc-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-zinc-800"
            >
              Limpar filtros
            </button>
          </div>
        </div>

        <div className="mb-6 rounded-2xl border border-white/10 bg-zinc-950 px-4 py-3 text-sm text-zinc-300">
          Exibindo {filteredPolicies.length} apólice(s).
        </div>

        <div className="space-y-5">
          {loading ? (
            <div className="rounded-3xl border border-white/10 bg-zinc-950 p-8 text-center text-zinc-400">
              Carregando apólices...
            </div>
          ) : filteredPolicies.length === 0 ? (
            <div className="rounded-3xl border border-white/10 bg-zinc-950 p-8 text-center text-zinc-400">
              Nenhuma apólice encontrada.
            </div>
          ) : (
            filteredPolicies.map((policy) => {
              const status = getPolicyStatus(policy.data_vencimento);
              const days = getDaysRemaining(policy.data_vencimento);

              return (
                <div
                  key={policy.id}
                  className={`rounded-3xl border p-5 ${
                    status.key === 'vencido'
                      ? 'border-red-500/40 bg-red-950/30'
                      : 'border-white/10 bg-zinc-950'
                  }`}
                >
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div className="flex-1">
                      <div className="mb-4 flex flex-wrap items-center gap-3">
                        <h2 className="text-4xl font-bold tracking-tight">
                          {policy.empresa_segurada || policy.cliente}
                        </h2>
                        <span
                          className={`rounded-full border px-3 py-1 text-sm font-medium ${status.color}`}
                        >
                          {status.label}
                        </span>
                      </div>

                      <div className="grid gap-3 text-base md:grid-cols-2 xl:grid-cols-4">
                        <div>
                          <span className="text-zinc-400">Cliente:</span>{' '}
                          <span className="font-semibold">{policy.cliente}</span>
                        </div>
                        <div>
                          <span className="text-zinc-400">Tipo:</span>{' '}
                          <span className="font-semibold">{policy.tipo_seguro}</span>
                        </div>
                        <div>
                          <span className="text-zinc-400">Seguradora:</span>{' '}
                          <span className="font-semibold">{policy.seguradora}</span>
                        </div>
                        <div>
                          <span className="text-zinc-400">Origem:</span>{' '}
                          <span className="font-semibold">{policy.origem || '-'}</span>
                        </div>
                        <div>
                          <span className="text-zinc-400">Vencimento:</span>{' '}
                          <span className="font-semibold">{formatDate(policy.data_vencimento)}</span>
                        </div>
                        <div>
                          <span className="text-zinc-400">Prêmio:</span>{' '}
                          <span className="font-semibold">{formatCurrency(policy.premio)}</span>
                        </div>
                        <div>
                          <span className="text-zinc-400">Dias restantes:</span>{' '}
                          <span className="font-semibold">
                            {days < 0
                              ? `${Math.abs(days)} dia${Math.abs(days) === 1 ? '' : 's'} em atraso`
                              : `${days} dia${days === 1 ? '' : 's'}`}
                          </span>
                        </div>
                      </div>

                      <div className="mt-4 rounded-2xl bg-zinc-900 px-4 py-3 text-sm text-zinc-300">
                        <span className="font-medium text-white">Observações:</span>{' '}
                        {policy.observacoes || 'Sem observações'}
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        {policy.pdf_url ? (
                          <>
                            <a
                              href={policy.pdf_url}
                              target="_blank"
                              rel="noreferrer"
                              className="rounded-2xl border border-white/10 bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800"
                            >
                              Ver PDF
                            </a>
                            <a
                              href={policy.pdf_url}
                              download
                              className="rounded-2xl border border-white/10 bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800"
                            >
                              Baixar PDF
                            </a>
                          </>
                        ) : (
                          <span className="rounded-2xl border border-white/10 bg-zinc-900 px-4 py-2 text-sm text-zinc-400">
                            Sem PDF anexado
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => handleEdit(policy)}
                        className="rounded-2xl border border-white/10 bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => handleDelete(policy.id)}
                        className="rounded-2xl border border-red-500/20 bg-red-950/40 px-4 py-2 text-sm font-medium text-red-200 transition hover:bg-red-950/60"
                      >
                        Remover
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="mt-8 rounded-3xl border border-white/10 bg-zinc-950 p-5">
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h3 className="text-3xl font-bold tracking-tight">Histórico de Alertas</h3>
              <p className="mt-1 text-sm text-zinc-400">
                Últimos alertas registrados pelo sistema.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <input
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
                placeholder="Filtrar por cliente, tipo ou destinatário"
                className="rounded-2xl border border-white/10 bg-zinc-900 px-4 py-2 text-sm text-white outline-none placeholder:text-zinc-500"
              />
              <button
                onClick={loadAlertLogs}
                className="rounded-2xl border border-white/10 bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800"
              >
                Atualizar histórico
              </button>
            </div>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-white/10">
            <table className="min-w-full text-sm">
              <thead className="bg-zinc-900">
                <tr className="text-left text-zinc-300">
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
                {loadingLogs ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-zinc-400">
                      Carregando histórico...
                    </td>
                  </tr>
                ) : filteredAlertLogs.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-zinc-400">
                      Nenhum alerta registrado ainda.
                    </td>
                  </tr>
                ) : (
                  filteredAlertLogs.map((log) => (
                    <tr key={log.id} className="border-t border-white/10">
                      <td className="px-4 py-3">{formatDateTime(log.created_at)}</td>
                      <td className="px-4 py-3">{formatDate(log.reference_date)}</td>
                      <td className="px-4 py-3">{log.policy_label || '-'}</td>
                      <td className="px-4 py-3">{log.alert_type || '-'}</td>
                      <td className="px-4 py-3">{log.recipient_email || log.sent_to || '-'}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-medium ${
                            (log.status || '').toLowerCase() === 'enviado'
                              ? 'bg-emerald-500/20 text-emerald-200'
                              : 'bg-zinc-800 text-zinc-300'
                          }`}
                        >
                          {log.status || '-'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-red-300">{log.error_message || '-'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {openModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
            <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-3xl border border-white/10 bg-zinc-950 p-6 shadow-2xl">
              <div className="mb-6 flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-2xl font-bold">
                    {editingId ? 'Editar apólice' : 'Nova apólice'}
                  </h3>
                  <p className="mt-1 text-sm text-zinc-400">
                    Preencha os dados e, se quiser, anexe o PDF da apólice.
                  </p>
                </div>

                <button
                  onClick={resetForm}
                  className="rounded-2xl border border-white/10 px-3 py-2 text-sm text-white transition hover:bg-zinc-900"
                >
                  Fechar
                </button>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm text-zinc-300">Cliente *</label>
                  <input
                    value={form.cliente}
                    onChange={(e) => handleChange('cliente', e.target.value)}
                    className="w-full rounded-2xl border border-white/10 bg-zinc-900 px-4 py-3 text-white outline-none"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm text-zinc-300">Empresa segurada *</label>
                  <input
                    value={form.empresa_segurada}
                    onChange={(e) => handleChange('empresa_segurada', e.target.value)}
                    className="w-full rounded-2xl border border-white/10 bg-zinc-900 px-4 py-3 text-white outline-none"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm text-zinc-300">Tipo de seguro *</label>
                  <input
                    value={form.tipo_seguro}
                    onChange={(e) => handleChange('tipo_seguro', e.target.value)}
                    className="w-full rounded-2xl border border-white/10 bg-zinc-900 px-4 py-3 text-white outline-none"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm text-zinc-300">Seguradora *</label>
                  <input
                    value={form.seguradora}
                    onChange={(e) => handleChange('seguradora', e.target.value)}
                    className="w-full rounded-2xl border border-white/10 bg-zinc-900 px-4 py-3 text-white outline-none"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm text-zinc-300">Data de vencimento *</label>
                  <input
                    type="date"
                    value={form.data_vencimento}
                    onChange={(e) => handleChange('data_vencimento', e.target.value)}
                    className="w-full rounded-2xl border border-white/10 bg-zinc-900 px-4 py-3 text-white outline-none"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm text-zinc-300">Prêmio</label>
                  <input
                    value={form.premio}
                    onChange={(e) => handleChange('premio', e.target.value)}
                    placeholder="Ex.: 16864.16"
                    className="w-full rounded-2xl border border-white/10 bg-zinc-900 px-4 py-3 text-white outline-none"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm text-zinc-300">Origem</label>
                  <input
                    value={form.origem}
                    onChange={(e) => handleChange('origem', e.target.value)}
                    className="w-full rounded-2xl border border-white/10 bg-zinc-900 px-4 py-3 text-white outline-none"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="mb-2 block text-sm text-zinc-300">Observações</label>
                  <textarea
                    value={form.observacoes}
                    onChange={(e) => handleChange('observacoes', e.target.value)}
                    rows={4}
                    className="w-full rounded-2xl border border-white/10 bg-zinc-900 px-4 py-3 text-white outline-none"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="mb-2 block text-sm text-zinc-300">PDF da apólice</label>
                  <input
                    type="file"
                    accept="application/pdf"
                    onChange={(e) => setSelectedPdf(e.target.files?.[0] || null)}
                    className="block w-full rounded-2xl border border-white/10 bg-zinc-900 px-4 py-3 text-sm text-white file:mr-4 file:rounded-xl file:border-0 file:bg-white file:px-4 file:py-2 file:text-sm file:font-semibold file:text-black"
                  />

                  {selectedPdf && (
                    <p className="mt-2 text-sm text-emerald-300">
                      PDF selecionado: {selectedPdf.name}
                    </p>
                  )}

                  {!selectedPdf && activeEditingPolicy?.pdf_url && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <a
                        href={activeEditingPolicy.pdf_url}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-2xl border border-white/10 bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800"
                      >
                        Ver PDF atual
                      </a>

                      <button
                        type="button"
                        onClick={() => handleRemovePdf(activeEditingPolicy.id)}
                        disabled={removingPdf}
                        className="rounded-2xl border border-red-500/20 bg-red-950/40 px-4 py-2 text-sm font-medium text-red-200 transition hover:bg-red-950/60 disabled:opacity-50"
                      >
                        {removingPdf ? 'Removendo PDF...' : 'Remover PDF'}
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-6 flex justify-end gap-3">
                <button
                  onClick={resetForm}
                  className="rounded-2xl border border-white/10 bg-zinc-900 px-5 py-3 text-sm font-medium text-white transition hover:bg-zinc-800"
                >
                  Cancelar
                </button>

                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-black transition hover:opacity-90 disabled:opacity-50"
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