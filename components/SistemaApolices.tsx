"use client";

import React, { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

type TipoCliente = "PF" | "PJ" | "";
type Carteira = "Alta Renda" | "Empresarial" | "Renovacao" | "";
type StatusApolice = "ativa" | "vencida" | "renovada" | "perdida";
type DueFilter = "" | "vencidas" | "1" | "15" | "45" | "60" | "sem_data";

type Policy = {
  id: string;
  cliente: string | null;
  empresa_segurad: string | null;
  tipo_seguro: string | null;
  seguradora: string | null;
  data_vencimento: string | null;
  premio: number | null;
  origem: string | null;
  observacoes: string | null;
  pdf_url: string | null;

  tipo_cliente: "PF" | "PJ" | null;
  carteira: "Alta Renda" | "Empresarial" | "Renovacao" | null;
  status_apolice: StatusApolice | null;
  renewed_from_id: string | null;
  renewal_reviewed_at: string | null;
  observacao_perda: string | null;
  updated_at?: string | null;
};

type EmailLog = {
  id: string;
  apolice_id: string;
  email_destino: string | null;
  assunto: string | null;
  status: "enviado" | "falhou" | "realizado";
  mensagem_erro: string | null;
  pdf_url: string | null;
  enviado_em: string | null;
};

type RenewalForm = {
  cliente: string;
  empresa_segurad: string;
  tipo_seguro: string;
  seguradora: string;
  data_vencimento: string;
  premio: string;
  origem: string;
  observacoes: string;
  tipo_cliente: "PF" | "PJ";
  carteira: "Alta Renda" | "Empresarial" | "Renovacao";
};

type ManualForm = {
  cliente: string;
  empresa_segurad: string;
  tipo_seguro: string;
  seguradora: string;
  data_vencimento: string;
  premio: string;
  origem: string;
  observacoes: string;
  tipo_cliente: TipoCliente;
  carteira: Carteira;
};

type ImportRow = {
  cliente: string;
  empresa_segurad: string;
  tipo_seguro: string;
  seguradora: string;
  data_vencimento: string;
  premio: string;
  origem: string;
  observacoes: string;
  tipo_cliente: string;
  carteira: string;
  pdf_url: string;
};

const initialForm: ManualForm = {
  cliente: "",
  empresa_segurad: "",
  tipo_seguro: "",
  seguradora: "",
  data_vencimento: "",
  premio: "",
  origem: "Sistema",
  observacoes: "",
  tipo_cliente: "",
  carteira: "",
};

const STORAGE_BUCKET = "apolices";

function normalizeText(value: string | null | undefined) {
  return (value || "").trim();
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value || 0);
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  const datePart = value.slice(0, 10);
  const [y, m, d] = datePart.split("-");
  if (!y || !m || !d) return value;
  return `${d}/${m}/${y}`;
}

function toNumber(value: string | number | null | undefined) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const normalized = String(value ?? "")
    .replace(/\./g, "")
    .replace(",", ".")
    .replace(/[^\d.-]/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getTodayISO() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
}

function getDaysUntil(dateStr?: string | null) {
  if (!dateStr) return null;
  const today = new Date(getTodayISO() + "T00:00:00");
  const due = new Date(dateStr.slice(0, 10) + "T00:00:00");
  const diff = Math.round((due.getTime() - today.getTime()) / 86400000);
  return diff;
}

function getDueLabel(days: number | null) {
  if (days === null) return "Sem data";
  if (days < 0) return "Vencida";
  if (days === 0) return "Vence hoje";
  if (days === 1) return "Vence em 1 dia";
  return `Vence em ${days} dias`;
}

function getDueBucket(days: number | null): DueFilter {
  if (days === null) return "sem_data";
  if (days < 0) return "vencidas";
  if (days <= 1) return "1";
  if (days <= 15) return "15";
  if (days <= 45) return "45";
  if (days <= 60) return "60";
  return "";
}

function isEligibleAltaRenda(tipoCliente: string, premio: string | number) {
  return tipoCliente === "PF" && toNumber(premio) > 10000;
}

function getDefaultCarteira(tipoCliente: string, premio: string | number): Carteira {
  if (isEligibleAltaRenda(tipoCliente, premio)) return "Alta Renda";
  if (tipoCliente === "PJ") return "Empresarial";
  if (tipoCliente === "PF") return "Renovacao";
  return "";
}

function sanitizeCarteira(
  tipoCliente: string,
  premio: string | number,
  carteira: string
): Carteira {
  if (!carteira) return getDefaultCarteira(tipoCliente, premio);
  if (carteira === "Alta Renda" && !isEligibleAltaRenda(tipoCliente, premio)) {
    return getDefaultCarteira(tipoCliente, premio);
  }
  return (carteira as Carteira) || getDefaultCarteira(tipoCliente, premio);
}

function splitCsvLine(line: string, separator: string) {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === separator && !inQuotes) {
      result.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  result.push(current.trim());
  return result.map((item) => item.replace(/^"(.*)"$/, "$1").trim());
}

function parseCsv(text: string) {
  const clean = text.replace(/\r/g, "").trim();
  if (!clean) return [];

  const firstLine = clean.split("\n")[0] || "";
  const separator = firstLine.includes(";") ? ";" : ",";

  const lines = clean
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) return [];

  const headers = splitCsvLine(lines[0], separator).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line, separator);
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? "";
    });
    return row;
  });
}

function downloadCsvTemplate() {
  const headers = [
    "cliente",
    "empresa_segurad",
    "tipo_seguro",
    "seguradora",
    "data_vencimento",
    "premio",
    "origem",
    "observacoes",
    "tipo_cliente",
    "carteira",
    "pdf_url",
  ];

  const sample = [
    [
      "Cliente Exemplo",
      "Cliente Exemplo",
      "Saude",
      "Porto",
      "2026-12-15",
      "15000",
      "Excel",
      "Observacao opcional",
      "PF",
      "Alta Renda",
      "",
    ],
  ];

  const csv = [headers.join(";"), ...sample.map((row) => row.join(";"))].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "modelo_importacao_apolices_excel.csv";
  link.click();
  URL.revokeObjectURL(url);
}

function buildPiePath(
  cx: number,
  cy: number,
  radius: number,
  startAngle: number,
  endAngle: number
) {
  const start = polarToCartesian(cx, cy, radius, endAngle);
  const end = polarToCartesian(cx, cy, radius, startAngle);
  const largeArc = endAngle - startAngle <= 180 ? 0 : 1;
  return [
    `M ${cx} ${cy}`,
    `L ${start.x} ${start.y}`,
    `A ${radius} ${radius} 0 ${largeArc} 0 ${end.x} ${end.y}`,
    "Z",
  ].join(" ");
}

function polarToCartesian(cx: number, cy: number, radius: number, angleInDegrees: number) {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180.0;
  return {
    x: cx + radius * Math.cos(angleInRadians),
    y: cy + radius * Math.sin(angleInRadians),
  };
}

const PIE_COLORS = [
  "#60a5fa",
  "#34d399",
  "#fbbf24",
  "#f472b6",
  "#a78bfa",
  "#fb7185",
  "#22d3ee",
  "#f97316",
];

export default function SistemaApolices() {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [emailLogs, setEmailLogs] = useState<EmailLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const [filtroBusca, setFiltroBusca] = useState("");
  const [filtroTipoCliente, setFiltroTipoCliente] = useState<TipoCliente>("");
  const [filtroCarteira, setFiltroCarteira] = useState<Carteira>("");
  const [filtroStatus, setFiltroStatus] = useState<StatusApolice | "">("");
  const [filtroVencimento, setFiltroVencimento] = useState<DueFilter>("");

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showImportArea, setShowImportArea] = useState(false);
  const [form, setForm] = useState<ManualForm>(initialForm);
  const [manualPdfFile, setManualPdfFile] = useState<File | null>(null);

  const [editingPolicy, setEditingPolicy] = useState<Policy | null>(null);
  const [editForm, setEditForm] = useState<ManualForm | null>(null);
  const [editPdfFile, setEditPdfFile] = useState<File | null>(null);

  const [expiredPolicyModal, setExpiredPolicyModal] = useState<Policy | null>(null);
  const [renewalMode, setRenewalMode] = useState<"choice" | "renew" | "lost">("choice");
  const [lostObservation, setLostObservation] = useState("");
  const [renewalForm, setRenewalForm] = useState<RenewalForm | null>(null);
  const [renewalPdfFile, setRenewalPdfFile] = useState<File | null>(null);

  const [selectedClientName, setSelectedClientName] = useState<string | null>(null);

  const importInputRef = useRef<HTMLInputElement | null>(null);

  async function syncExpiredPolicies() {
    const { error } = await supabase.rpc("sync_expired_policies");
    if (error) {
      console.error("Erro ao sincronizar apólices vencidas:", error);
    }
  }

  async function fetchEmailLogs() {
    const { data, error } = await supabase
      .from("apolice_email_logs")
      .select("*")
      .order("enviado_em", { ascending: false });

    if (error) {
      console.error("Erro ao carregar logs de e-mail:", error);
      return;
    }

    setEmailLogs((data || []) as EmailLog[]);
  }

  async function fetchPolicies() {
    setLoading(true);
    setErrorMsg("");
    setSuccessMsg("");

    await syncExpiredPolicies();

    const { data, error } = await supabase
      .from("policies")
      .select("*")
      .order("data_vencimento", { ascending: true });

    if (error) {
      console.error(error);
      setErrorMsg("Erro ao carregar apólices.");
      setLoading(false);
      return;
    }

    setPolicies((data || []) as Policy[]);
    setLoading(false);
  }

  async function refreshAll() {
    await Promise.all([fetchPolicies(), fetchEmailLogs()]);
  }

  useEffect(() => {
    refreshAll();
  }, []);

  useEffect(() => {
    if (expiredPolicyModal) return;

    const pendingExpired = policies.find((ap) => {
      const status = ap.status_apolice ?? "ativa";
      const reviewed = !!ap.renewal_reviewed_at;
      const days = getDaysUntil(ap.data_vencimento);
      return days !== null && days < 0 && !reviewed && (status === "ativa" || status === "vencida");
    });

    if (pendingExpired) {
      setExpiredPolicyModal(pendingExpired);
      setRenewalMode("choice");
      setLostObservation("");
      setRenewalPdfFile(null);
      setRenewalForm({
        cliente: pendingExpired.cliente || "",
        empresa_segurad: pendingExpired.empresa_segurad || pendingExpired.cliente || "",
        tipo_seguro: pendingExpired.tipo_seguro || "",
        seguradora: pendingExpired.seguradora || "",
        data_vencimento: "",
        premio: String(pendingExpired.premio ?? ""),
        origem: pendingExpired.origem || "Sistema",
        observacoes: "",
        tipo_cliente: (pendingExpired.tipo_cliente || "PF") as "PF" | "PJ",
        carteira: sanitizeCarteira(
          pendingExpired.tipo_cliente || "PF",
          pendingExpired.premio ?? 0,
          pendingExpired.carteira || ""
        ) as "Alta Renda" | "Empresarial" | "Renovacao",
      });
    }
  }, [policies, expiredPolicyModal]);

  useEffect(() => {
    setForm((prev) => {
      const adjustedCarteira = sanitizeCarteira(prev.tipo_cliente, prev.premio, prev.carteira);
      if (adjustedCarteira === prev.carteira) return prev;
      return { ...prev, carteira: adjustedCarteira };
    });
  }, [form.tipo_cliente, form.premio]);

  const latestEmailLogMap = useMemo(() => {
    const map = new Map<string, EmailLog>();
    emailLogs.forEach((log) => {
      if (!map.has(log.apolice_id)) {
        map.set(log.apolice_id, log);
      }
    });
    return map;
  }, [emailLogs]);

  const policiesWithMeta = useMemo(() => {
    return policies.map((policy) => {
      const days = getDaysUntil(policy.data_vencimento);
      const dueBucket = getDueBucket(days);
      const latestEmail = latestEmailLogMap.get(policy.id) || null;
      return {
        ...policy,
        _daysUntil: days,
        _dueBucket: dueBucket,
        _latestEmail: latestEmail,
      };
    });
  }, [policies, latestEmailLogMap]);

  const filteredPolicies = useMemo(() => {
    return policiesWithMeta.filter((ap) => {
      const busca = filtroBusca.trim().toLowerCase();

      const matchBusca =
        !busca ||
        normalizeText(ap.cliente).toLowerCase().includes(busca) ||
        normalizeText(ap.empresa_segurad).toLowerCase().includes(busca) ||
        normalizeText(ap.tipo_seguro).toLowerCase().includes(busca) ||
        normalizeText(ap.seguradora).toLowerCase().includes(busca);

      const matchTipoCliente = !filtroTipoCliente || ap.tipo_cliente === filtroTipoCliente;
      const matchCarteira = !filtroCarteira || ap.carteira === filtroCarteira;
      const matchStatus = !filtroStatus || ap.status_apolice === filtroStatus;
      const matchDue = !filtroVencimento || ap._dueBucket === filtroVencimento;

      return matchBusca && matchTipoCliente && matchCarteira && matchStatus && matchDue;
    });
  }, [policiesWithMeta, filtroBusca, filtroTipoCliente, filtroCarteira, filtroStatus, filtroVencimento]);

  const dashboard = useMemo(() => {
    const totalApolices = filteredPolicies.length;
    const distinctClientes = new Set(
      filteredPolicies
        .map((a) => normalizeText(a.cliente || a.empresa_segurad))
        .filter(Boolean)
    ).size;

    const premioTotal = filteredPolicies.reduce((acc, item) => acc + toNumber(item.premio), 0);
    const premioTotalPF = filteredPolicies
      .filter((a) => a.tipo_cliente === "PF")
      .reduce((acc, item) => acc + toNumber(item.premio), 0);
    const premioTotalPJ = filteredPolicies
      .filter((a) => a.tipo_cliente === "PJ")
      .reduce((acc, item) => acc + toNumber(item.premio), 0);
    const apolicesRenovadas = filteredPolicies.filter((a) => a.status_apolice === "renovada").length;
    const apolicesPerdidas = filteredPolicies.filter((a) => a.status_apolice === "perdida").length;

    const porSeguradora = Object.entries(
      filteredPolicies.reduce<Record<string, number>>((acc, item) => {
        const key = item.seguradora || "Sem seguradora";
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {})
    ).sort((a, b) => b[1] - a[1]);

    const dueCounts = filteredPolicies.reduce(
      (acc, item) => {
        const bucket = item._dueBucket;
        if (bucket === "vencidas") acc.vencidas += 1;
        if (bucket === "1") acc.umDia += 1;
        if (bucket === "15") acc.quinze += 1;
        if (bucket === "45") acc.quarentaCinco += 1;
        if (bucket === "60") acc.sessenta += 1;
        if (bucket === "sem_data") acc.semData += 1;
        return acc;
      },
      {
        vencidas: 0,
        umDia: 0,
        quinze: 0,
        quarentaCinco: 0,
        sessenta: 0,
        semData: 0,
      }
    );

    return {
      totalApolices,
      distinctClientes,
      premioTotal,
      premioTotalPF,
      premioTotalPJ,
      apolicesRenovadas,
      apolicesPerdidas,
      porSeguradora,
      dueCounts,
    };
  }, [filteredPolicies]);

  const clientChartData = useMemo(() => {
    const grouped = filteredPolicies.reduce<Record<string, { cliente: string; premio: number; seguradoras: Set<string>; totalApolices: number }>>(
      (acc, item) => {
        const cliente = normalizeText(item.cliente || item.empresa_segurad || "Sem cliente");
        if (!acc[cliente]) {
          acc[cliente] = {
            cliente,
            premio: 0,
            seguradoras: new Set<string>(),
            totalApolices: 0,
          };
        }
        acc[cliente].premio += toNumber(item.premio);
        acc[cliente].totalApolices += 1;
        if (item.seguradora) acc[cliente].seguradoras.add(item.seguradora);
        return acc;
      },
      {}
    );

    const list = Object.values(grouped)
      .sort((a, b) => b.premio - a.premio)
      .slice(0, 8);

    const total = list.reduce((acc, item) => acc + item.premio, 0) || 1;

    let angle = 0;
    return list.map((item, index) => {
      const percentage = (item.premio / total) * 100;
      const angleSpan = (item.premio / total) * 360;
      const startAngle = angle;
      const endAngle = angle + angleSpan;
      angle = endAngle;

      return {
        ...item,
        percentage,
        color: PIE_COLORS[index % PIE_COLORS.length],
        path: buildPiePath(110, 110, 90, startAngle, endAngle),
      };
    });
  }, [filteredPolicies]);

  const selectedClientPolicies = useMemo(() => {
    if (!selectedClientName) return [];
    return filteredPolicies.filter(
      (item) => normalizeText(item.cliente || item.empresa_segurad || "Sem cliente") === selectedClientName
    );
  }, [filteredPolicies, selectedClientName]);

  async function uploadPdf(file: File) {
    const fileExt = file.name.split(".").pop() || "pdf";
    const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${fileExt}`;
    const filePath = `apolices/${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(filePath, file, {
        cacheControl: "3600",
        upsert: false,
      });

    if (uploadError) {
      throw uploadError;
    }

    const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(filePath);
    return data.publicUrl;
  }

  async function handleCreatePolicy(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErrorMsg("");
    setSuccessMsg("");

    try {
      if (!form.tipo_cliente) {
        throw new Error("Selecione se o cliente é PF ou PJ.");
      }

      const adjustedCarteira = sanitizeCarteira(form.tipo_cliente, form.premio, form.carteira);
      if (!adjustedCarteira) {
        throw new Error("Selecione a carteira.");
      }

      let pdfUrl: string | null = null;
      if (manualPdfFile) {
        pdfUrl = await uploadPdf(manualPdfFile);
      }

      const payload = {
        cliente: form.cliente || null,
        empresa_segurad: form.empresa_segurad || form.cliente || null,
        tipo_seguro: form.tipo_seguro || null,
        seguradora: form.seguradora || null,
        data_vencimento: form.data_vencimento || null,
        premio: toNumber(form.premio),
        origem: form.origem || "Sistema",
        observacoes: form.observacoes || null,
        pdf_url: pdfUrl,
        tipo_cliente: form.tipo_cliente || null,
        carteira: adjustedCarteira || null,
        status_apolice: "ativa" as StatusApolice,
      };

      const { error } = await supabase.from("policies").insert(payload).select();

      if (error) throw error;

      setForm(initialForm);
      setManualPdfFile(null);
      setShowCreateForm(false);
      setSuccessMsg("Apólice cadastrada com sucesso.");
      await refreshAll();
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err?.message || "Erro ao criar apólice.");
    } finally {
      setSaving(false);
    }
  }

  function openEditPolicy(policy: Policy) {
    setEditingPolicy(policy);
    setEditPdfFile(null);
    setEditForm({
      cliente: policy.cliente || "",
      empresa_segurad: policy.empresa_segurad || "",
      tipo_seguro: policy.tipo_seguro || "",
      seguradora: policy.seguradora || "",
      data_vencimento: policy.data_vencimento || "",
      premio: String(policy.premio ?? ""),
      origem: policy.origem || "Sistema",
      observacoes: policy.observacoes || "",
      tipo_cliente: (policy.tipo_cliente || "") as TipoCliente,
      carteira: sanitizeCarteira(
        policy.tipo_cliente || "",
        policy.premio ?? 0,
        policy.carteira || ""
      ) as Carteira,
    });
  }

  async function handleSaveEditPolicy() {
    if (!editingPolicy || !editForm) return;

    setSaving(true);
    setErrorMsg("");
    setSuccessMsg("");

    try {
      if (!editForm.tipo_cliente) {
        throw new Error("Selecione se o cliente é PF ou PJ.");
      }

      const adjustedCarteira = sanitizeCarteira(editForm.tipo_cliente, editForm.premio, editForm.carteira);
      if (!adjustedCarteira) {
        throw new Error("Selecione uma carteira válida.");
      }

      let pdfUrl = editingPolicy.pdf_url || null;
      if (editPdfFile) {
        pdfUrl = await uploadPdf(editPdfFile);
      }

      const { error } = await supabase
        .from("policies")
        .update({
          cliente: editForm.cliente || null,
          empresa_segurad: editForm.empresa_segurad || editForm.cliente || null,
          tipo_seguro: editForm.tipo_seguro || null,
          seguradora: editForm.seguradora || null,
          data_vencimento: editForm.data_vencimento || null,
          premio: toNumber(editForm.premio),
          origem: editForm.origem || "Sistema",
          observacoes: editForm.observacoes || null,
          pdf_url: pdfUrl,
          tipo_cliente: editForm.tipo_cliente || null,
          carteira: adjustedCarteira || null,
        })
        .eq("id", editingPolicy.id)
        .select();

      if (error) throw error;

      setEditingPolicy(null);
      setEditForm(null);
      setEditPdfFile(null);
      setSuccessMsg("Apólice atualizada com sucesso.");
      await refreshAll();
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err?.message || "Erro ao atualizar apólice.");
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdateStatus(id: string, status: StatusApolice) {
    const { error } = await supabase
      .from("policies")
      .update({ status_apolice: status })
      .eq("id", id)
      .select();

    if (error) {
      console.error(error);
      alert("Erro ao atualizar status.");
      return;
    }

    setSuccessMsg("Status atualizado.");
    await refreshAll();
  }

  async function handleRenewPolicy() {
    if (!expiredPolicyModal || !renewalForm) return;

    if (!renewalForm.data_vencimento) {
      alert("Informe a nova data de vencimento.");
      return;
    }

    setSaving(true);

    try {
      let newPdfUrl: string | null = null;

      if (renewalPdfFile) {
        newPdfUrl = await uploadPdf(renewalPdfFile);
      }

      const newPolicyPayload = {
        cliente: renewalForm.cliente || null,
        empresa_segurad: renewalForm.empresa_segurad || renewalForm.cliente || null,
        tipo_seguro: renewalForm.tipo_seguro || null,
        seguradora: renewalForm.seguradora || null,
        data_vencimento: renewalForm.data_vencimento || null,
        premio: toNumber(renewalForm.premio),
        origem: renewalForm.origem || "Sistema",
        observacoes: renewalForm.observacoes || null,
        pdf_url: newPdfUrl,
        tipo_cliente: renewalForm.tipo_cliente,
        carteira: sanitizeCarteira(renewalForm.tipo_cliente, renewalForm.premio, renewalForm.carteira),
        status_apolice: "ativa" as StatusApolice,
        renewed_from_id: expiredPolicyModal.id,
        renewal_reviewed_at: null,
        observacao_perda: null,
      };

      const { error: insertError } = await supabase
        .from("policies")
        .insert(newPolicyPayload)
        .select();

      if (insertError) throw insertError;

      const { error: updateOldError } = await supabase
        .from("policies")
        .update({
          status_apolice: "renovada",
          renewal_reviewed_at: new Date().toISOString(),
        })
        .eq("id", expiredPolicyModal.id)
        .select();

      if (updateOldError) throw updateOldError;

      setExpiredPolicyModal(null);
      setRenewalMode("choice");
      setRenewalForm(null);
      setRenewalPdfFile(null);
      setSuccessMsg("Renovação salva com sucesso.");

      await refreshAll();
    } catch (err: any) {
      console.error(err);
      alert(err?.message || "Erro ao renovar apólice.");
    } finally {
      setSaving(false);
    }
  }

  async function handleLostPolicy() {
    if (!expiredPolicyModal) return;

    setSaving(true);

    const { error } = await supabase
      .from("policies")
      .update({
        status_apolice: "perdida",
        renewal_reviewed_at: new Date().toISOString(),
        observacao_perda: lostObservation || null,
      })
      .eq("id", expiredPolicyModal.id)
      .select();

    setSaving(false);

    if (error) {
      console.error(error);
      alert("Erro ao marcar apólice como perdida.");
      return;
    }

    setExpiredPolicyModal(null);
    setRenewalMode("choice");
    setLostObservation("");
    setSuccessMsg("Apólice marcada como perdida.");
    await refreshAll();
  }

  function closeExpiredModalTemporarily() {
    setExpiredPolicyModal(null);
    setRenewalMode("choice");
    setLostObservation("");
    setRenewalPdfFile(null);
    setRenewalForm(null);
  }

  async function handleImportFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setImporting(true);
    setErrorMsg("");
    setSuccessMsg("");

    try {
      const text = await file.text();
      const rows = parseCsv(text) as ImportRow[];

      if (!rows.length) {
        throw new Error("A planilha está vazia ou fora do formato esperado.");
      }

      const payload = rows.map((row, index) => {
        const tipoCliente = (row.tipo_cliente || "").trim();
        const premio = toNumber(row.premio);
        const carteira = sanitizeCarteira(tipoCliente, premio, row.carteira || "");

        if (!row.cliente || !row.tipo_seguro || !row.seguradora || !row.data_vencimento) {
          throw new Error(`Linha ${index + 2}: preencha cliente, tipo_seguro, seguradora e data_vencimento.`);
        }

        if (!["PF", "PJ"].includes(tipoCliente)) {
          throw new Error(`Linha ${index + 2}: tipo_cliente deve ser PF ou PJ.`);
        }

        if (!carteira) {
          throw new Error(`Linha ${index + 2}: carteira inválida.`);
        }

        return {
          cliente: row.cliente || null,
          empresa_segurad: row.empresa_segurad || row.cliente || null,
          tipo_seguro: row.tipo_seguro || null,
          seguradora: row.seguradora || null,
          data_vencimento: row.data_vencimento || null,
          premio,
          origem: row.origem || "Excel",
          observacoes: row.observacoes || null,
          tipo_cliente: tipoCliente as "PF" | "PJ",
          carteira: carteira as "Alta Renda" | "Empresarial" | "Renovacao",
          pdf_url: row.pdf_url || null,
          status_apolice: "ativa" as StatusApolice,
        };
      });

      const { error } = await supabase.from("policies").insert(payload).select();
      if (error) throw error;

      setSuccessMsg(`${payload.length} apólice(s) importada(s) com sucesso.`);
      setShowImportArea(false);
      if (importInputRef.current) importInputRef.current.value = "";
      await refreshAll();
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err?.message || "Erro ao importar planilha.");
    } finally {
      setImporting(false);
    }
  }

  const dueCardItems = [
    {
      key: "vencidas" as DueFilter,
      title: "Vencidas",
      value: dashboard.dueCounts.vencidas,
      accent: "#ef4444",
      bg: "#2a0d0d",
    },
    {
      key: "1" as DueFilter,
      title: "Em 1 dia",
      value: dashboard.dueCounts.umDia,
      accent: "#f97316",
      bg: "#2b1307",
    },
    {
      key: "15" as DueFilter,
      title: "Até 15 dias",
      value: dashboard.dueCounts.quinze,
      accent: "#eab308",
      bg: "#2a2207",
    },
    {
      key: "45" as DueFilter,
      title: "Até 45 dias",
      value: dashboard.dueCounts.quarentaCinco,
      accent: "#3b82f6",
      bg: "#0b1d39",
    },
    {
      key: "60" as DueFilter,
      title: "Até 60 dias",
      value: dashboard.dueCounts.sessenta,
      accent: "#8b5cf6",
      bg: "#1e1336",
    },
  ];

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div>
          <div style={styles.logoTitleRow}>
            <h1 style={styles.title}>Acompanhamento de Apólices</h1>
          </div>
          <p style={styles.subtitle}>
            Gestão completa de apólices, vencimentos, e-mails, importação e renovação.
          </p>
        </div>

        <div style={styles.headerButtons}>
          <button
            style={styles.secondaryButton}
            onClick={downloadCsvTemplate}
            type="button"
          >
            Baixar modelo Excel
          </button>

          <button
            style={styles.secondaryButton}
            onClick={() => setShowImportArea((v) => !v)}
            type="button"
          >
            {showImportArea ? "Fechar importação" : "Importar em lote"}
          </button>

          <button
            style={styles.primaryButton}
            onClick={() => setShowCreateForm(true)}
            type="button"
          >
            Nova apólice
          </button>
        </div>
      </div>

      {errorMsg ? <div style={styles.errorBox}>{errorMsg}</div> : null}
      {successMsg ? <div style={styles.successBox}>{successMsg}</div> : null}

      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Atalhos por vencimento</h2>
        <div style={styles.kpiGrid}>
          {dueCardItems.map((item) => {
            const active = filtroVencimento === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setFiltroVencimento(active ? "" : item.key)}
                style={{
                  ...styles.kpiCardButton,
                  borderColor: item.accent,
                  background: item.bg,
                  boxShadow: active ? `0 0 0 2px ${item.accent}` : "none",
                }}
              >
                <div style={{ ...styles.kpiTopLine, background: item.accent }} />
                <div style={styles.kpiLabel}>{item.title}</div>
                <div style={styles.kpiValue}>{item.value}</div>
                <div style={styles.kpiHint}>{active ? "Filtro ativo" : "Clique para abrir"}</div>
              </button>
            );
          })}
        </div>
      </section>

      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Resumo da carteira</h2>
        <div style={styles.kpiGrid}>
          <div style={styles.card}>
            <div style={styles.kpiLabel}>Total de apólices</div>
            <div style={styles.kpiValue}>{dashboard.totalApolices}</div>
          </div>
          <div style={styles.card}>
            <div style={styles.kpiLabel}>Quantidade de clientes</div>
            <div style={styles.kpiValue}>{dashboard.distinctClientes}</div>
          </div>
          <div style={styles.card}>
            <div style={styles.kpiLabel}>Prêmio total</div>
            <div style={styles.kpiValue}>{formatMoney(dashboard.premioTotal)}</div>
          </div>
          <div style={styles.card}>
            <div style={styles.kpiLabel}>Prêmio total PF</div>
            <div style={styles.kpiValue}>{formatMoney(dashboard.premioTotalPF)}</div>
          </div>
          <div style={styles.card}>
            <div style={styles.kpiLabel}>Prêmio total PJ</div>
            <div style={styles.kpiValue}>{formatMoney(dashboard.premioTotalPJ)}</div>
          </div>
          <div style={{ ...styles.card, borderColor: "#166534" }}>
            <div style={styles.kpiLabel}>Renovadas</div>
            <div style={{ ...styles.kpiValue, color: "#86efac" }}>{dashboard.apolicesRenovadas}</div>
          </div>
          <div style={{ ...styles.card, borderColor: "#7f1d1d" }}>
            <div style={styles.kpiLabel}>Perdidas</div>
            <div style={{ ...styles.kpiValue, color: "#fca5a5" }}>{dashboard.apolicesPerdidas}</div>
          </div>
        </div>
      </section>

      <section style={styles.section}>
        <div style={styles.sectionHeaderRow}>
          <h2 style={styles.sectionTitle}>Dashboard visual</h2>
          <button style={styles.secondaryButton} onClick={refreshAll} type="button">
            Atualizar
          </button>
        </div>

        <div style={styles.dashboardRow}>
          <div style={styles.chartCard}>
            <h3 style={styles.smallTitle}>Clientes por prêmio</h3>
            {clientChartData.length === 0 ? (
              <p style={styles.muted}>Sem dados para o gráfico.</p>
            ) : (
              <div style={styles.chartWrap}>
                <svg width="220" height="220" viewBox="0 0 220 220">
                  {clientChartData.map((slice) => (
                    <path
                      key={slice.cliente}
                      d={slice.path}
                      fill={slice.color}
                      stroke="#000000"
                      strokeWidth={2}
                      style={{ cursor: "pointer" }}
                      onClick={() => setSelectedClientName(slice.cliente)}
                    />
                  ))}
                  <circle cx="110" cy="110" r="42" fill="#000000" />
                  <text
                    x="110"
                    y="105"
                    textAnchor="middle"
                    fill="#ffffff"
                    fontSize="12"
                    fontWeight="700"
                  >
                    Clientes
                  </text>
                  <text
                    x="110"
                    y="122"
                    textAnchor="middle"
                    fill="#9ca3af"
                    fontSize="11"
                  >
                    clique na fatia
                  </text>
                </svg>

                <div style={styles.legendList}>
                  {clientChartData.map((slice) => (
                    <button
                      key={slice.cliente}
                      type="button"
                      style={styles.legendButton}
                      onClick={() => setSelectedClientName(slice.cliente)}
                    >
                      <span
                        style={{
                          ...styles.legendDot,
                          background: slice.color,
                        }}
                      />
                      <span style={styles.legendText}>
                        {slice.cliente} — {slice.percentage.toFixed(1)}%
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div style={styles.card}>
            <h3 style={styles.smallTitle}>Apólices por seguradora</h3>
            {dashboard.porSeguradora.length === 0 ? (
              <p style={styles.muted}>Sem dados.</p>
            ) : (
              <div style={styles.list}>
                {dashboard.porSeguradora.map(([seg, qtd]) => (
                  <div key={seg} style={styles.listRow}>
                    <span>{seg}</span>
                    <strong>{qtd}</strong>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {showImportArea && (
        <section style={styles.section}>
          <h2 style={styles.sectionTitle}>Importação em lote</h2>
          <p style={styles.helperText}>
            Use o modelo compatível com Excel, preencha as linhas e importe o arquivo CSV.
          </p>

          <div style={styles.importBox}>
            <input
              ref={importInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={handleImportFile}
              style={styles.fileInput}
            />
            <div style={styles.importActions}>
              <button type="button" style={styles.secondaryButton} onClick={downloadCsvTemplate}>
                Baixar modelo
              </button>
              <span style={styles.muted}>
                {importing ? "Importando..." : "Aceita CSV compatível com Excel"}
              </span>
            </div>
          </div>
        </section>
      )}

      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Filtros</h2>

        <div style={styles.filtersGrid}>
          <input
            style={styles.input}
            placeholder="Buscar por cliente, seguradora, tipo..."
            value={filtroBusca}
            onChange={(e) => setFiltroBusca(e.target.value)}
          />

          <select
            style={styles.input}
            value={filtroTipoCliente}
            onChange={(e) => setFiltroTipoCliente(e.target.value as TipoCliente)}
          >
            <option value="">Todos PF/PJ</option>
            <option value="PF">PF</option>
            <option value="PJ">PJ</option>
          </select>

          <select
            style={styles.input}
            value={filtroCarteira}
            onChange={(e) => setFiltroCarteira(e.target.value as Carteira)}
          >
            <option value="">Todas carteiras</option>
            <option value="Alta Renda">Alta Renda</option>
            <option value="Empresarial">Empresarial</option>
            <option value="Renovacao">Renovacao</option>
          </select>

          <select
            style={styles.input}
            value={filtroStatus}
            onChange={(e) => setFiltroStatus(e.target.value as StatusApolice | "")}
          >
            <option value="">Todos os status</option>
            <option value="ativa">Ativa</option>
            <option value="vencida">Vencida</option>
            <option value="renovada">Renovada</option>
            <option value="perdida">Perdida</option>
          </select>

          <select
            style={styles.input}
            value={filtroVencimento}
            onChange={(e) => setFiltroVencimento(e.target.value as DueFilter)}
          >
            <option value="">Todos os vencimentos</option>
            <option value="vencidas">Vencidas</option>
            <option value="1">Em 1 dia</option>
            <option value="15">Até 15 dias</option>
            <option value="45">Até 45 dias</option>
            <option value="60">Até 60 dias</option>
            <option value="sem_data">Sem data</option>
          </select>

          <button
            type="button"
            style={styles.secondaryButton}
            onClick={() => {
              setFiltroBusca("");
              setFiltroTipoCliente("");
              setFiltroCarteira("");
              setFiltroStatus("");
              setFiltroVencimento("");
            }}
          >
            Limpar filtros
          </button>
        </div>
      </section>

      <section style={styles.section}>
        <div style={styles.sectionHeaderRow}>
          <h2 style={styles.sectionTitle}>Apólices</h2>
          <div style={styles.muted}>
            {filteredPolicies.length} resultado(s)
          </div>
        </div>

        {loading ? (
          <div style={styles.card}>Carregando...</div>
        ) : filteredPolicies.length === 0 ? (
          <div style={styles.card}>Nenhuma apólice encontrada.</div>
        ) : (
          <div style={styles.tableWrapper}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Cliente</th>
                  <th style={styles.th}>Seguradora</th>
                  <th style={styles.th}>Tipo</th>
                  <th style={styles.th}>PF/PJ</th>
                  <th style={styles.th}>Carteira</th>
                  <th style={styles.th}>Vencimento</th>
                  <th style={styles.th}>Prêmio</th>
                  <th style={styles.th}>Status</th>
                  <th style={styles.th}>E-mail</th>
                  <th style={styles.th}>PDF</th>
                  <th style={styles.th}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {filteredPolicies.map((ap) => {
                  const emailLog = ap._latestEmail;
                  return (
                    <tr
                      key={ap.id}
                      style={styles.rowClickable}
                      onClick={() => openEditPolicy(ap)}
                    >
                      <td style={styles.td}>
                        <div style={styles.cellTitle}>{ap.cliente || "-"}</div>
                        <div style={styles.cellSubtitle}>{ap.empresa_segurad || "-"}</div>
                      </td>

                      <td style={styles.td}>{ap.seguradora || "-"}</td>
                      <td style={styles.td}>{ap.tipo_seguro || "-"}</td>
                      <td style={styles.td}>{ap.tipo_cliente || "-"}</td>
                      <td style={styles.td}>{ap.carteira || "-"}</td>

                      <td style={styles.td}>
                        <div
                          style={{
                            ...styles.badge,
                            ...(ap._daysUntil !== null && ap._daysUntil < 0
                              ? styles.badgeDanger
                              : ap._daysUntil !== null && ap._daysUntil <= 15
                              ? styles.badgeWarning
                              : styles.badgeInfo),
                          }}
                        >
                          {formatDate(ap.data_vencimento)}
                        </div>
                        <div style={styles.cellSubtitle}>{getDueLabel(ap._daysUntil)}</div>
                      </td>

                      <td style={styles.td}>{formatMoney(toNumber(ap.premio))}</td>

                      <td style={styles.td}>
                        <span
                          style={{
                            ...styles.badge,
                            ...(ap.status_apolice === "ativa"
                              ? styles.badgeSuccess
                              : ap.status_apolice === "vencida"
                              ? styles.badgeWarning
                              : ap.status_apolice === "renovada"
                              ? styles.badgeInfo
                              : styles.badgeDanger),
                          }}
                        >
                          {ap.status_apolice || "-"}
                        </span>
                      </td>

                      <td style={styles.td}>
                        {emailLog ? (
                          <>
                            <span
                              style={{
                                ...styles.badge,
                                ...(emailLog.status === "enviado"
                                  ? styles.badgeSuccess
                                  : emailLog.status === "realizado"
                                  ? styles.badgeInfo
                                  : styles.badgeDanger),
                              }}
                            >
                              {emailLog.status}
                            </span>
                            <div style={styles.cellSubtitle}>
                              {emailLog.email_destino || "Sem e-mail"}
                            </div>
                            <div style={styles.cellSubtitle}>
                              {emailLog.enviado_em ? formatDate(emailLog.enviado_em) : ""}
                            </div>
                          </>
                        ) : (
                          <span style={styles.badgeNeutralInline}>Sem registro</span>
                        )}
                      </td>

                      <td style={styles.td}>
                        {ap.pdf_url ? (
                          <a
                            href={ap.pdf_url}
                            target="_blank"
                            rel="noreferrer"
                            style={styles.link}
                            onClick={(e) => e.stopPropagation()}
                          >
                            Abrir PDF
                          </a>
                        ) : (
                          "-"
                        )}
                      </td>

                      <td style={styles.td}>
                        <div style={styles.actionButtons} onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            style={styles.actionBtn}
                            onClick={() => handleUpdateStatus(ap.id, "ativa")}
                          >
                            Ativa
                          </button>
                          <button
                            type="button"
                            style={styles.actionBtn}
                            onClick={() => handleUpdateStatus(ap.id, "vencida")}
                          >
                            Vencida
                          </button>
                          <button
                            type="button"
                            style={styles.actionBtn}
                            onClick={() => handleUpdateStatus(ap.id, "renovada")}
                          >
                            Renovada
                          </button>
                          <button
                            type="button"
                            style={styles.actionBtnDanger}
                            onClick={() => handleUpdateStatus(ap.id, "perdida")}
                          >
                            Perdida
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {showCreateForm && (
        <div style={styles.modalOverlay}>
          <div style={styles.modal}>
            <div style={styles.modalHeader}>
              <h2 style={styles.modalTitle}>Nova apólice</h2>
              <button
                type="button"
                style={styles.modalClose}
                onClick={() => {
                  setShowCreateForm(false);
                  setManualPdfFile(null);
                }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreatePolicy} style={styles.formGrid}>
              <input
                style={styles.input}
                placeholder="Cliente"
                value={form.cliente}
                onChange={(e) => setForm({ ...form, cliente: e.target.value })}
                required
              />

              <input
                style={styles.input}
                placeholder="Empresa segurada"
                value={form.empresa_segurad}
                onChange={(e) => setForm({ ...form, empresa_segurad: e.target.value })}
              />

              <input
                style={styles.input}
                placeholder="Tipo de seguro"
                value={form.tipo_seguro}
                onChange={(e) => setForm({ ...form, tipo_seguro: e.target.value })}
                required
              />

              <input
                style={styles.input}
                placeholder="Seguradora"
                value={form.seguradora}
                onChange={(e) => setForm({ ...form, seguradora: e.target.value })}
                required
              />

              <input
                style={styles.input}
                type="date"
                value={form.data_vencimento}
                onChange={(e) => setForm({ ...form, data_vencimento: e.target.value })}
                required
              />

              <input
                style={styles.input}
                type="number"
                step="0.01"
                placeholder="Prêmio"
                value={form.premio}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    premio: e.target.value,
                    carteira: sanitizeCarteira(prev.tipo_cliente, e.target.value, prev.carteira),
                  }))
                }
                required
              />

              <select
                style={styles.input}
                value={form.tipo_cliente}
                onChange={(e) => {
                  const nextTipo = e.target.value as TipoCliente;
                  setForm((prev) => ({
                    ...prev,
                    tipo_cliente: nextTipo,
                    carteira: sanitizeCarteira(nextTipo, prev.premio, prev.carteira),
                  }));
                }}
                required
              >
                <option value="">Tipo de cliente</option>
                <option value="PF">PF</option>
                <option value="PJ">PJ</option>
              </select>

              <select
                style={styles.input}
                value={form.carteira}
                onChange={(e) => {
                  const nextCarteira = e.target.value as Carteira;
                  setForm((prev) => ({
                    ...prev,
                    carteira: sanitizeCarteira(prev.tipo_cliente, prev.premio, nextCarteira),
                  }));
                }}
                required
              >
                <option value="">Carteira</option>
                <option
                  value="Alta Renda"
                  disabled={!isEligibleAltaRenda(form.tipo_cliente, form.premio)}
                >
                  Alta Renda
                </option>
                <option value="Empresarial">Empresarial</option>
                <option value="Renovacao">Renovacao</option>
              </select>

              <input
                style={styles.input}
                placeholder="Origem"
                value={form.origem}
                onChange={(e) => setForm({ ...form, origem: e.target.value })}
              />

              <label style={styles.uploadLabel}>
                <span>Anexar PDF</span>
                <input
                  type="file"
                  accept="application/pdf"
                  onChange={(e) => setManualPdfFile(e.target.files?.[0] || null)}
                  style={styles.hiddenInput}
                />
                <span style={styles.uploadValue}>
                  {manualPdfFile ? manualPdfFile.name : "Selecionar arquivo"}
                </span>
              </label>

              <textarea
                style={{ ...styles.input, minHeight: 90, gridColumn: "1 / -1" }}
                placeholder="Observações"
                value={form.observacoes}
                onChange={(e) => setForm({ ...form, observacoes: e.target.value })}
              />

              <div style={styles.ruleHint}>
                Alta Renda fica disponível apenas para PF com prêmio acima de 10 mil.
              </div>

              <div style={{ gridColumn: "1 / -1", display: "flex", gap: 12 }}>
                <button type="submit" style={styles.primaryButton} disabled={saving}>
                  {saving ? "Salvando..." : "Salvar apólice"}
                </button>
                <button
                  type="button"
                  style={styles.secondaryButton}
                  onClick={() => {
                    setShowCreateForm(false);
                    setManualPdfFile(null);
                  }}
                >
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editingPolicy && editForm && (
        <div style={styles.modalOverlay}>
          <div style={styles.modal}>
            <div style={styles.modalHeader}>
              <h2 style={styles.modalTitle}>Editar apólice</h2>
              <button
                type="button"
                style={styles.modalClose}
                onClick={() => {
                  setEditingPolicy(null);
                  setEditForm(null);
                  setEditPdfFile(null);
                }}
              >
                ✕
              </button>
            </div>

            <div style={styles.formGrid}>
              <input
                style={styles.input}
                placeholder="Cliente"
                value={editForm.cliente}
                onChange={(e) => setEditForm({ ...editForm, cliente: e.target.value })}
              />

              <input
                style={styles.input}
                placeholder="Empresa segurada"
                value={editForm.empresa_segurad}
                onChange={(e) => setEditForm({ ...editForm, empresa_segurad: e.target.value })}
              />

              <input
                style={styles.input}
                placeholder="Tipo de seguro"
                value={editForm.tipo_seguro}
                onChange={(e) => setEditForm({ ...editForm, tipo_seguro: e.target.value })}
              />

              <input
                style={styles.input}
                placeholder="Seguradora"
                value={editForm.seguradora}
                onChange={(e) => setEditForm({ ...editForm, seguradora: e.target.value })}
              />

              <input
                style={styles.input}
                type="date"
                value={editForm.data_vencimento}
                onChange={(e) => setEditForm({ ...editForm, data_vencimento: e.target.value })}
              />

              <input
                style={styles.input}
                type="number"
                step="0.01"
                placeholder="Prêmio"
                value={editForm.premio}
                onChange={(e) =>
                  setEditForm({
                    ...editForm,
                    premio: e.target.value,
                    carteira: sanitizeCarteira(
                      editForm.tipo_cliente,
                      e.target.value,
                      editForm.carteira
                    ),
                  })
                }
              />

              <select
                style={styles.input}
                value={editForm.tipo_cliente}
                onChange={(e) =>
                  setEditForm({
                    ...editForm,
                    tipo_cliente: e.target.value as TipoCliente,
                    carteira: sanitizeCarteira(
                      e.target.value,
                      editForm.premio,
                      editForm.carteira
                    ),
                  })
                }
              >
                <option value="">Tipo de cliente</option>
                <option value="PF">PF</option>
                <option value="PJ">PJ</option>
              </select>

              <select
                style={styles.input}
                value={editForm.carteira}
                onChange={(e) =>
                  setEditForm({
                    ...editForm,
                    carteira: sanitizeCarteira(
                      editForm.tipo_cliente,
                      editForm.premio,
                      e.target.value
                    ),
                  })
                }
              >
                <option value="">Carteira</option>
                <option
                  value="Alta Renda"
                  disabled={!isEligibleAltaRenda(editForm.tipo_cliente, editForm.premio)}
                >
                  Alta Renda
                </option>
                <option value="Empresarial">Empresarial</option>
                <option value="Renovacao">Renovacao</option>
              </select>

              <input
                style={styles.input}
                placeholder="Origem"
                value={editForm.origem}
                onChange={(e) => setEditForm({ ...editForm, origem: e.target.value })}
              />

              <label style={styles.uploadLabel}>
                <span>Trocar PDF</span>
                <input
                  type="file"
                  accept="application/pdf"
                  onChange={(e) => setEditPdfFile(e.target.files?.[0] || null)}
                  style={styles.hiddenInput}
                />
                <span style={styles.uploadValue}>
                  {editPdfFile ? editPdfFile.name : "Selecionar arquivo"}
                </span>
              </label>

              <textarea
                style={{ ...styles.input, minHeight: 90, gridColumn: "1 / -1" }}
                placeholder="Observações"
                value={editForm.observacoes}
                onChange={(e) => setEditForm({ ...editForm, observacoes: e.target.value })}
              />

              <div style={styles.ruleHint}>
                Ajuste PF/PJ e carteira por aqui. O sistema agora define uma carteira válida automaticamente quando necessário.
              </div>

              <div style={{ gridColumn: "1 / -1", display: "flex", gap: 12 }}>
                <button
                  type="button"
                  style={styles.primaryButton}
                  onClick={handleSaveEditPolicy}
                  disabled={saving}
                >
                  {saving ? "Salvando..." : "Salvar alterações"}
                </button>
                <button
                  type="button"
                  style={styles.secondaryButton}
                  onClick={() => {
                    setEditingPolicy(null);
                    setEditForm(null);
                    setEditPdfFile(null);
                  }}
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {selectedClientName && (
        <div style={styles.modalOverlay}>
          <div style={styles.modal}>
            <div style={styles.modalHeader}>
              <h2 style={styles.modalTitle}>Cliente: {selectedClientName}</h2>
              <button
                type="button"
                style={styles.modalClose}
                onClick={() => setSelectedClientName(null)}
              >
                ✕
              </button>
            </div>

            <div style={styles.clientSummaryGrid}>
              <div style={styles.card}>
                <div style={styles.kpiLabel}>Total de apólices</div>
                <div style={styles.kpiValue}>{selectedClientPolicies.length}</div>
              </div>
              <div style={styles.card}>
                <div style={styles.kpiLabel}>Prêmio total</div>
                <div style={styles.kpiValue}>
                  {formatMoney(
                    selectedClientPolicies.reduce((acc, item) => acc + toNumber(item.premio), 0)
                  )}
                </div>
              </div>
            </div>

            <div style={styles.modalList}>
              {selectedClientPolicies.map((item) => (
                <div key={item.id} style={styles.clientDetailCard}>
                  <div style={styles.clientDetailTop}>
                    <strong>{item.seguradora || "Sem seguradora"}</strong>
                    <span>{formatMoney(toNumber(item.premio))}</span>
                  </div>
                  <div style={styles.clientDetailMeta}>
                    <span>{item.tipo_seguro || "-"}</span>
                    <span>{formatDate(item.data_vencimento)}</span>
                    <span>{item.status_apolice || "-"}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {expiredPolicyModal && (
        <div style={styles.modalOverlay}>
          <div style={styles.modal}>
            <div style={styles.modalHeader}>
              <h2 style={styles.modalTitle}>Apólice vencida</h2>
              <button
                type="button"
                style={styles.modalClose}
                onClick={closeExpiredModalTemporarily}
              >
                ✕
              </button>
            </div>

            <p style={styles.modalText}>
              A apólice de <strong>{expiredPolicyModal.cliente || "-"}</strong> venceu em{" "}
              <strong>{formatDate(expiredPolicyModal.data_vencimento)}</strong>.
            </p>

            {renewalMode === "choice" && (
              <>
                <p style={styles.modalText}>
                  Essa apólice foi renovada ou foi perdida para a concorrência?
                </p>

                <div style={styles.modalActions}>
                  <button
                    type="button"
                    style={styles.primaryButton}
                    onClick={() => setRenewalMode("renew")}
                  >
                    Foi renovada
                  </button>

                  <button
                    type="button"
                    style={styles.dangerButton}
                    onClick={() => setRenewalMode("lost")}
                  >
                    Foi perdida
                  </button>

                  <button
                    type="button"
                    style={styles.secondaryButton}
                    onClick={closeExpiredModalTemporarily}
                  >
                    Fechar por agora
                  </button>
                </div>
              </>
            )}

            {renewalMode === "renew" && renewalForm && (
              <>
                <h3 style={styles.smallTitle}>Nova vigência</h3>

                <div style={styles.formGrid}>
                  <input
                    style={styles.input}
                    placeholder="Cliente"
                    value={renewalForm.cliente}
                    onChange={(e) =>
                      setRenewalForm({ ...renewalForm, cliente: e.target.value })
                    }
                  />

                  <input
                    style={styles.input}
                    placeholder="Empresa segurada"
                    value={renewalForm.empresa_segurad}
                    onChange={(e) =>
                      setRenewalForm({
                        ...renewalForm,
                        empresa_segurad: e.target.value,
                      })
                    }
                  />

                  <input
                    style={styles.input}
                    placeholder="Tipo de seguro"
                    value={renewalForm.tipo_seguro}
                    onChange={(e) =>
                      setRenewalForm({
                        ...renewalForm,
                        tipo_seguro: e.target.value,
                      })
                    }
                  />

                  <input
                    style={styles.input}
                    placeholder="Seguradora"
                    value={renewalForm.seguradora}
                    onChange={(e) =>
                      setRenewalForm({
                        ...renewalForm,
                        seguradora: e.target.value,
                      })
                    }
                  />

                  <input
                    style={styles.input}
                    type="date"
                    value={renewalForm.data_vencimento}
                    onChange={(e) =>
                      setRenewalForm({
                        ...renewalForm,
                        data_vencimento: e.target.value,
                      })
                    }
                  />

                  <input
                    style={styles.input}
                    type="number"
                    step="0.01"
                    placeholder="Novo prêmio"
                    value={renewalForm.premio}
                    onChange={(e) =>
                      setRenewalForm({
                        ...renewalForm,
                        premio: e.target.value,
                        carteira: sanitizeCarteira(
                          renewalForm.tipo_cliente,
                          e.target.value,
                          renewalForm.carteira
                        ) as "Alta Renda" | "Empresarial" | "Renovacao",
                      })
                    }
                  />

                  <select
                    style={styles.input}
                    value={renewalForm.tipo_cliente}
                    onChange={(e) =>
                      setRenewalForm({
                        ...renewalForm,
                        tipo_cliente: e.target.value as "PF" | "PJ",
                        carteira: sanitizeCarteira(
                          e.target.value,
                          renewalForm.premio,
                          renewalForm.carteira
                        ) as "Alta Renda" | "Empresarial" | "Renovacao",
                      })
                    }
                  >
                    <option value="PF">PF</option>
                    <option value="PJ">PJ</option>
                  </select>

                  <select
                    style={styles.input}
                    value={renewalForm.carteira}
                    onChange={(e) =>
                      setRenewalForm({
                        ...renewalForm,
                        carteira: sanitizeCarteira(
                          renewalForm.tipo_cliente,
                          renewalForm.premio,
                          e.target.value
                        ) as "Alta Renda" | "Empresarial" | "Renovacao",
                      })
                    }
                  >
                    <option value="Alta Renda" disabled={!isEligibleAltaRenda(renewalForm.tipo_cliente, renewalForm.premio)}>
                      Alta Renda
                    </option>
                    <option value="Empresarial">Empresarial</option>
                    <option value="Renovacao">Renovacao</option>
                  </select>

                  <input
                    style={styles.input}
                    placeholder="Origem"
                    value={renewalForm.origem}
                    onChange={(e) =>
                      setRenewalForm({
                        ...renewalForm,
                        origem: e.target.value,
                      })
                    }
                  />

                  <label style={styles.uploadLabel}>
                    <span>Anexar novo PDF</span>
                    <input
                      type="file"
                      accept="application/pdf"
                      onChange={(e) => setRenewalPdfFile(e.target.files?.[0] || null)}
                      style={styles.hiddenInput}
                    />
                    <span style={styles.uploadValue}>
                      {renewalPdfFile ? renewalPdfFile.name : "Selecionar arquivo"}
                    </span>
                  </label>

                  <textarea
                    style={{ ...styles.input, minHeight: 80, gridColumn: "1 / -1" }}
                    placeholder="Observações"
                    value={renewalForm.observacoes}
                    onChange={(e) =>
                      setRenewalForm({
                        ...renewalForm,
                        observacoes: e.target.value,
                      })
                    }
                  />
                </div>

                <div style={styles.modalActions}>
                  <button
                    type="button"
                    style={styles.primaryButton}
                    onClick={handleRenewPolicy}
                    disabled={saving}
                  >
                    {saving ? "Salvando..." : "Salvar renovação"}
                  </button>

                  <button
                    type="button"
                    style={styles.secondaryButton}
                    onClick={() => setRenewalMode("choice")}
                  >
                    Voltar
                  </button>
                </div>
              </>
            )}

            {renewalMode === "lost" && (
              <>
                <h3 style={styles.smallTitle}>Perdida para concorrente</h3>

                <textarea
                  style={{ ...styles.input, minHeight: 120, width: "100%" }}
                  placeholder="Observação opcional"
                  value={lostObservation}
                  onChange={(e) => setLostObservation(e.target.value)}
                />

                <div style={styles.modalActions}>
                  <button
                    type="button"
                    style={styles.dangerButton}
                    onClick={handleLostPolicy}
                    disabled={saving}
                  >
                    {saving ? "Salvando..." : "Confirmar perda"}
                  </button>

                  <button
                    type="button"
                    style={styles.secondaryButton}
                    onClick={() => setRenewalMode("choice")}
                  >
                    Voltar
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    padding: 24,
    background: "#000000",
    minHeight: "100vh",
    color: "#f5f5f5",
    fontFamily: "Arial, sans-serif",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 16,
    marginBottom: 24,
    flexWrap: "wrap",
  },
  logoTitleRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
  },
  headerButtons: {
    display: "flex",
    gap: 10,
    flexWrap: "wrap",
  },
  title: {
    margin: 0,
    fontSize: 28,
    fontWeight: 700,
    color: "#ffffff",
  },
  subtitle: {
    margin: "10px 0 0",
    color: "#a3a3a3",
  },
  section: {
    background: "#0c0c0c",
    borderRadius: 18,
    padding: 20,
    border: "1px solid #262626",
    marginBottom: 20,
    boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
  },
  sectionTitle: {
    margin: "0 0 16px 0",
    fontSize: 20,
    fontWeight: 700,
    color: "#ffffff",
  },
  sectionHeaderRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    marginBottom: 16,
    flexWrap: "wrap",
  },
  smallTitle: {
    margin: "0 0 12px 0",
    fontSize: 16,
    fontWeight: 700,
    color: "#ffffff",
  },
  kpiGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 14,
  },
  kpiCardButton: {
    borderRadius: 14,
    border: "1px solid",
    padding: 16,
    textAlign: "left",
    color: "#f5f5f5",
    cursor: "pointer",
  },
  kpiTopLine: {
    width: 42,
    height: 4,
    borderRadius: 999,
    marginBottom: 10,
  },
  kpiHint: {
    color: "#c7c7c7",
    fontSize: 12,
    marginTop: 8,
  },
  card: {
    background: "#111111",
    border: "1px solid #262626",
    borderRadius: 14,
    padding: 16,
  },
  chartCard: {
    background: "#111111",
    border: "1px solid #262626",
    borderRadius: 14,
    padding: 16,
    minWidth: 0,
  },
  dashboardRow: {
    display: "grid",
    gridTemplateColumns: "minmax(320px, 1.2fr) minmax(260px, 1fr)",
    gap: 16,
  },
  chartWrap: {
    display: "grid",
    gridTemplateColumns: "220px 1fr",
    gap: 16,
    alignItems: "center",
  },
  legendList: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  legendButton: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    background: "transparent",
    border: "1px solid #2d2d2d",
    color: "#e5e5e5",
    borderRadius: 10,
    padding: "10px 12px",
    cursor: "pointer",
    textAlign: "left",
  },
  legendDot: {
    width: 12,
    height: 12,
    borderRadius: 999,
    flexShrink: 0,
  },
  legendText: {
    fontSize: 13,
  },
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  listRow: {
    display: "flex",
    justifyContent: "space-between",
    borderBottom: "1px solid #1f1f1f",
    paddingBottom: 8,
    color: "#e5e5e5",
  },
  kpiLabel: {
    fontSize: 13,
    color: "#c7c7c7",
    marginBottom: 8,
  },
  kpiValue: {
    fontSize: 24,
    fontWeight: 700,
    color: "#ffffff",
  },
  filtersGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
    gap: 12,
  },
  formGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 12,
  },
  input: {
    width: "100%",
    padding: "12px 14px",
    borderRadius: 10,
    border: "1px solid #3a3a3a",
    fontSize: 14,
    outline: "none",
    boxSizing: "border-box",
    background: "#161616",
    color: "#f5f5f5",
  },
  uploadLabel: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    padding: "12px 14px",
    borderRadius: 10,
    border: "1px solid #3a3a3a",
    background: "#161616",
    color: "#f5f5f5",
    cursor: "pointer",
  },
  uploadValue: {
    color: "#d4d4d8",
    fontSize: 13,
  },
  hiddenInput: {
    display: "none",
  },
  primaryButton: {
    border: "none",
    borderRadius: 10,
    padding: "12px 16px",
    background: "#ffffff",
    color: "#000000",
    cursor: "pointer",
    fontWeight: 700,
  },
  secondaryButton: {
    border: "1px solid #3a3a3a",
    borderRadius: 10,
    padding: "12px 16px",
    background: "#111111",
    color: "#f5f5f5",
    cursor: "pointer",
    fontWeight: 600,
  },
  dangerButton: {
    border: "none",
    borderRadius: 10,
    padding: "12px 16px",
    background: "#7f1d1d",
    color: "#ffffff",
    cursor: "pointer",
    fontWeight: 700,
  },
  helperText: {
    color: "#a3a3a3",
    marginTop: -4,
    marginBottom: 14,
  },
  importBox: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  fileInput: {
    ...({
      width: "100%",
      padding: "12px 14px",
      borderRadius: 10,
      border: "1px solid #3a3a3a",
      fontSize: 14,
      background: "#161616",
      color: "#f5f5f5",
      boxSizing: "border-box",
    } as React.CSSProperties),
  },
  importActions: {
    display: "flex",
    gap: 12,
    alignItems: "center",
    flexWrap: "wrap",
  },
  ruleHint: {
    gridColumn: "1 / -1",
    color: "#d4d4d8",
    fontSize: 13,
  },
  actionButtons: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
  },
  actionBtn: {
    border: "1px solid #3a3a3a",
    borderRadius: 8,
    padding: "6px 10px",
    background: "#141414",
    cursor: "pointer",
    fontSize: 12,
    color: "#f5f5f5",
  },
  actionBtnDanger: {
    border: "1px solid #7f1d1d",
    borderRadius: 8,
    padding: "6px 10px",
    background: "#2a0d0d",
    cursor: "pointer",
    fontSize: 12,
    color: "#fecaca",
  },
  tableWrapper: {
    overflowX: "auto",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    minWidth: 1400,
  },
  th: {
    textAlign: "left",
    padding: "12px 10px",
    borderBottom: "1px solid #2b2b2b",
    background: "#111111",
    fontSize: 13,
    color: "#d4d4d8",
    position: "sticky",
    top: 0,
  },
  td: {
    padding: "12px 10px",
    borderBottom: "1px solid #1f1f1f",
    fontSize: 14,
    verticalAlign: "top",
    color: "#f5f5f5",
  },
  rowClickable: {
    cursor: "pointer",
  },
  cellTitle: {
    fontWeight: 700,
    marginBottom: 4,
  },
  cellSubtitle: {
    color: "#a3a3a3",
    fontSize: 12,
    marginTop: 4,
  },
  badge: {
    display: "inline-block",
    borderRadius: 999,
    padding: "6px 10px",
    fontSize: 12,
    fontWeight: 700,
  },
  badgeSuccess: {
    background: "#052e16",
    color: "#86efac",
    border: "1px solid #166534",
  },
  badgeWarning: {
    background: "#422006",
    color: "#fcd34d",
    border: "1px solid #b45309",
  },
  badgeInfo: {
    background: "#172554",
    color: "#93c5fd",
    border: "1px solid #1d4ed8",
  },
  badgeDanger: {
    background: "#450a0a",
    color: "#fca5a5",
    border: "1px solid #b91c1c",
  },
  badgeNeutralInline: {
    display: "inline-block",
    borderRadius: 999,
    padding: "6px 10px",
    fontSize: 12,
    fontWeight: 700,
    background: "#1f1f1f",
    color: "#d4d4d8",
  },
  link: {
    color: "#ffffff",
    textDecoration: "underline",
    fontWeight: 600,
  },
  modalOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0, 0, 0, 0.82)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 9999,
    padding: 20,
  },
  modal: {
    width: "100%",
    maxWidth: 950,
    background: "#0c0c0c",
    borderRadius: 16,
    padding: 24,
    border: "1px solid #2b2b2b",
    boxShadow: "0 10px 40px rgba(0,0,0,0.45)",
    maxHeight: "90vh",
    overflowY: "auto",
  },
  modalHeader: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    alignItems: "center",
    marginBottom: 8,
  },
  modalTitle: {
    margin: 0,
    fontSize: 22,
    fontWeight: 700,
    color: "#ffffff",
  },
  modalClose: {
    background: "transparent",
    color: "#d4d4d8",
    border: "1px solid #3a3a3a",
    width: 36,
    height: 36,
    borderRadius: 10,
    cursor: "pointer",
  },
  modalText: {
    margin: "0 0 12px 0",
    lineHeight: 1.5,
    color: "#e5e5e5",
  },
  modalActions: {
    display: "flex",
    gap: 12,
    flexWrap: "wrap",
    marginTop: 16,
  },
  muted: {
    color: "#a3a3a3",
  },
  modalList: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    marginTop: 16,
  },
  clientDetailCard: {
    border: "1px solid #2b2b2b",
    background: "#111111",
    borderRadius: 12,
    padding: 14,
  },
  clientDetailTop: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 8,
    color: "#ffffff",
  },
  clientDetailMeta: {
    display: "flex",
    gap: 12,
    flexWrap: "wrap",
    color: "#a3a3a3",
    fontSize: 13,
  },
  clientSummaryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 12,
    marginTop: 12,
  },
  errorBox: {
    marginBottom: 16,
    padding: 12,
    borderRadius: 10,
    background: "#2a0d0d",
    color: "#fecaca",
    fontWeight: 600,
    border: "1px solid #7f1d1d",
  },
  successBox: {
    marginBottom: 16,
    padding: 12,
    borderRadius: 10,
    background: "#052e16",
    color: "#86efac",
    fontWeight: 600,
    border: "1px solid #166534",
  },
};