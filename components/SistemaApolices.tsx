"use client";

import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type TipoCliente = "PF" | "PJ" | "";
type Carteira = "Alta Renda" | "Empresarial" | "Renovacao" | "";
type StatusApolice = "ativa" | "vencida" | "renovada" | "perdida";

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

const initialForm = {
  cliente: "",
  empresa_segurad: "",
  tipo_seguro: "",
  seguradora: "",
  data_vencimento: "",
  premio: "",
  origem: "Excel",
  observacoes: "",
  tipo_cliente: "" as TipoCliente,
  carteira: "" as Carteira,
};

export default function SistemaApolices() {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const [filtroBusca, setFiltroBusca] = useState("");
  const [filtroTipoCliente, setFiltroTipoCliente] = useState<TipoCliente>("");
  const [filtroCarteira, setFiltroCarteira] = useState<Carteira>("");
  const [filtroStatus, setFiltroStatus] = useState<StatusApolice | "">("");

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [form, setForm] = useState(initialForm);

  const [expiredPolicyModal, setExpiredPolicyModal] = useState<Policy | null>(null);
  const [renewalMode, setRenewalMode] = useState<"choice" | "renew" | "lost">("choice");
  const [lostObservation, setLostObservation] = useState("");
  const [renewalForm, setRenewalForm] = useState<RenewalForm | null>(null);
  const [renewalPdfFile, setRenewalPdfFile] = useState<File | null>(null);

  const todayStr = new Date().toISOString().slice(0, 10);

  const currencyBRL = (value: number) =>
    new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(value || 0);

  const safeNumber = (v: any) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  const formatDate = (date?: string | null) => {
    if (!date) return "-";
    const [y, m, d] = date.slice(0, 10).split("-");
    if (!y || !m || !d) return date;
    return `${d}/${m}/${y}`;
  };

  const isExpired = (date?: string | null) => {
    if (!date) return false;
    return date.slice(0, 10) < todayStr;
  };

  async function syncExpiredPolicies() {
    const { error } = await supabase.rpc("sync_expired_policies");
    if (error) {
      console.error("Erro ao sincronizar apólices vencidas:", error);
    }
  }

  async function fetchPolicies() {
    setLoading(true);
    setErrorMsg("");

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

  useEffect(() => {
    fetchPolicies();
  }, []);

  useEffect(() => {
    if (expiredPolicyModal) return;

    const pendingExpired = policies.find((ap) => {
      const status = ap.status_apolice ?? "ativa";
      const reviewed = !!ap.renewal_reviewed_at;

      return (
        isExpired(ap.data_vencimento) &&
        !reviewed &&
        (status === "ativa" || status === "vencida")
      );
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
        premio: pendingExpired.premio?.toString() || "",
        origem: pendingExpired.origem || "Excel",
        observacoes: "",
        tipo_cliente: (pendingExpired.tipo_cliente || "PF") as "PF" | "PJ",
        carteira: (pendingExpired.carteira || "Alta Renda") as
          | "Alta Renda"
          | "Empresarial"
          | "Renovacao",
      });
    }
  }, [policies, expiredPolicyModal]);

  const filteredPolicies = useMemo(() => {
    return policies.filter((ap) => {
      const busca = filtroBusca.trim().toLowerCase();

      const matchBusca =
        !busca ||
        (ap.cliente || "").toLowerCase().includes(busca) ||
        (ap.empresa_segurad || "").toLowerCase().includes(busca) ||
        (ap.tipo_seguro || "").toLowerCase().includes(busca) ||
        (ap.seguradora || "").toLowerCase().includes(busca);

      const matchTipoCliente =
        !filtroTipoCliente || ap.tipo_cliente === filtroTipoCliente;

      const matchCarteira =
        !filtroCarteira || ap.carteira === filtroCarteira;

      const matchStatus =
        !filtroStatus || ap.status_apolice === filtroStatus;

      return matchBusca && matchTipoCliente && matchCarteira && matchStatus;
    });
  }, [policies, filtroBusca, filtroTipoCliente, filtroCarteira, filtroStatus]);

  const dashboard = useMemo(() => {
    const totalApolices = filteredPolicies.length;

    const distinctClientes = new Set(
      filteredPolicies
        .map((a) => (a.cliente || a.empresa_segurad || "").trim())
        .filter(Boolean)
    ).size;

    const premioTotal = filteredPolicies.reduce(
      (acc, item) => acc + safeNumber(item.premio),
      0
    );

    const premioTotalPF = filteredPolicies
      .filter((a) => a.tipo_cliente === "PF")
      .reduce((acc, item) => acc + safeNumber(item.premio), 0);

    const premioTotalPJ = filteredPolicies
      .filter((a) => a.tipo_cliente === "PJ")
      .reduce((acc, item) => acc + safeNumber(item.premio), 0);

    const apolicesRenovadas = filteredPolicies.filter(
      (a) => a.status_apolice === "renovada"
    ).length;

    const apolicesPerdidas = filteredPolicies.filter(
      (a) => a.status_apolice === "perdida"
    ).length;

    const porTipoSeguro = Object.entries(
      filteredPolicies.reduce<Record<string, number>>((acc, item) => {
        const key = item.tipo_seguro || "Sem tipo";
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {})
    ).sort((a, b) => b[1] - a[1]);

    const porSeguradora = Object.entries(
      filteredPolicies.reduce<Record<string, number>>((acc, item) => {
        const key = item.seguradora || "Sem seguradora";
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {})
    ).sort((a, b) => b[1] - a[1]);

    return {
      totalApolices,
      distinctClientes,
      premioTotal,
      premioTotalPF,
      premioTotalPJ,
      apolicesRenovadas,
      apolicesPerdidas,
      porTipoSeguro,
      porSeguradora,
    };
  }, [filteredPolicies]);

  async function handleCreatePolicy(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErrorMsg("");

    const payload = {
      cliente: form.cliente || null,
      empresa_segurad: form.empresa_segurad || form.cliente || null,
      tipo_seguro: form.tipo_seguro || null,
      seguradora: form.seguradora || null,
      data_vencimento: form.data_vencimento || null,
      premio: form.premio ? Number(form.premio) : 0,
      origem: form.origem || "Excel",
      observacoes: form.observacoes || null,
      tipo_cliente: form.tipo_cliente || null,
      carteira: form.carteira || null,
      status_apolice: "ativa" as StatusApolice,
    };

    const { error } = await supabase
      .from("policies")
      .insert(payload)
      .select();

    if (error) {
      console.error(error);
      setErrorMsg("Erro ao criar apólice.");
      setSaving(false);
      return;
    }

    setForm(initialForm);
    setShowCreateForm(false);
    setSaving(false);
    await fetchPolicies();
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

    await fetchPolicies();
  }

  async function uploadRenewalPdf(file: File) {
    const fileExt = file.name.split(".").pop() || "pdf";
    const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${fileExt}`;
    const filePath = `apolices/${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from("apolices")
      .upload(filePath, file, {
        cacheControl: "3600",
        upsert: false,
      });

    if (uploadError) {
      throw uploadError;
    }

    const { data } = supabase.storage.from("apolices").getPublicUrl(filePath);
    return data.publicUrl;
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
        newPdfUrl = await uploadRenewalPdf(renewalPdfFile);
      }

      const newPolicyPayload = {
        cliente: renewalForm.cliente || null,
        empresa_segurad: renewalForm.empresa_segurad || renewalForm.cliente || null,
        tipo_seguro: renewalForm.tipo_seguro || null,
        seguradora: renewalForm.seguradora || null,
        data_vencimento: renewalForm.data_vencimento || null,
        premio: renewalForm.premio ? Number(renewalForm.premio) : 0,
        origem: renewalForm.origem || "Excel",
        observacoes: renewalForm.observacoes || null,
        pdf_url: newPdfUrl,
        tipo_cliente: renewalForm.tipo_cliente,
        carteira: renewalForm.carteira,
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

      await fetchPolicies();
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

    await fetchPolicies();
  }

  function closeExpiredModalTemporarily() {
    setExpiredPolicyModal(null);
    setRenewalMode("choice");
    setLostObservation("");
    setRenewalPdfFile(null);
    setRenewalForm(null);
  }

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>Sistema de Apólices</h1>
          <p style={styles.subtitle}>
            Gestão de apólices, renovação, perda, filtros e dashboard.
          </p>
        </div>

        <button
          style={styles.primaryButton}
          onClick={() => setShowCreateForm((v) => !v)}
        >
          {showCreateForm ? "Fechar cadastro" : "Nova apólice"}
        </button>
      </div>

      {errorMsg ? <div style={styles.errorBox}>{errorMsg}</div> : null}

      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Dashboard</h2>

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
            <div style={styles.kpiLabel}>Prêmio total da carteira</div>
            <div style={styles.kpiValue}>{currencyBRL(dashboard.premioTotal)}</div>
          </div>

          <div style={styles.card}>
            <div style={styles.kpiLabel}>Prêmio total PF</div>
            <div style={styles.kpiValue}>{currencyBRL(dashboard.premioTotalPF)}</div>
          </div>

          <div style={styles.card}>
            <div style={styles.kpiLabel}>Prêmio total PJ</div>
            <div style={styles.kpiValue}>{currencyBRL(dashboard.premioTotalPJ)}</div>
          </div>

          <div style={styles.card}>
            <div style={styles.kpiLabel}>Apólices renovadas</div>
            <div style={styles.kpiValue}>{dashboard.apolicesRenovadas}</div>
          </div>

          <div style={styles.card}>
            <div style={styles.kpiLabel}>Apólices perdidas</div>
            <div style={styles.kpiValue}>{dashboard.apolicesPerdidas}</div>
          </div>
        </div>

        <div style={styles.twoColumns}>
          <div style={styles.card}>
            <h3 style={styles.smallTitle}>Apólices por tipo de seguro</h3>
            {dashboard.porTipoSeguro.length === 0 ? (
              <p style={styles.muted}>Sem dados.</p>
            ) : (
              <div style={styles.list}>
                {dashboard.porTipoSeguro.map(([tipo, qtd]) => (
                  <div key={tipo} style={styles.listRow}>
                    <span>{tipo}</span>
                    <strong>{qtd}</strong>
                  </div>
                ))}
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

      {showCreateForm && (
        <section style={styles.section}>
          <h2 style={styles.sectionTitle}>Cadastrar apólice</h2>

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
              onChange={(e) =>
                setForm({ ...form, empresa_segurad: e.target.value })
              }
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
              onChange={(e) =>
                setForm({ ...form, data_vencimento: e.target.value })
              }
              required
            />

            <input
              style={styles.input}
              type="number"
              step="0.01"
              placeholder="Prêmio"
              value={form.premio}
              onChange={(e) => setForm({ ...form, premio: e.target.value })}
              required
            />

            <select
              style={styles.input}
              value={form.tipo_cliente}
              onChange={(e) =>
                setForm({ ...form, tipo_cliente: e.target.value as TipoCliente })
              }
              required
            >
              <option value="">Tipo de cliente</option>
              <option value="PF">PF</option>
              <option value="PJ">PJ</option>
            </select>

            <select
              style={styles.input}
              value={form.carteira}
              onChange={(e) =>
                setForm({ ...form, carteira: e.target.value as Carteira })
              }
              required
            >
              <option value="">Carteira</option>
              <option value="Alta Renda">Alta Renda</option>
              <option value="Empresarial">Empresarial</option>
              <option value="Renovacao">Renovacao</option>
            </select>

            <input
              style={styles.input}
              placeholder="Origem"
              value={form.origem}
              onChange={(e) => setForm({ ...form, origem: e.target.value })}
            />

            <textarea
              style={{ ...styles.input, minHeight: 90, gridColumn: "1 / -1" }}
              placeholder="Observações"
              value={form.observacoes}
              onChange={(e) => setForm({ ...form, observacoes: e.target.value })}
            />

            <div style={{ gridColumn: "1 / -1", display: "flex", gap: 12 }}>
              <button
                type="submit"
                style={styles.primaryButton}
                disabled={saving}
              >
                {saving ? "Salvando..." : "Salvar apólice"}
              </button>
            </div>
          </form>
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
            onChange={(e) =>
              setFiltroTipoCliente(e.target.value as TipoCliente)
            }
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
            onChange={(e) =>
              setFiltroStatus(e.target.value as StatusApolice | "")
            }
          >
            <option value="">Todos os status</option>
            <option value="ativa">Ativa</option>
            <option value="vencida">Vencida</option>
            <option value="renovada">Renovada</option>
            <option value="perdida">Perdida</option>
          </select>
        </div>
      </section>

      <section style={styles.section}>
        <div style={styles.tableHeader}>
          <h2 style={styles.sectionTitle}>Apólices</h2>
          <button style={styles.secondaryButton} onClick={fetchPolicies}>
            Atualizar
          </button>
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
                  <th style={styles.th}>Empresa segurada</th>
                  <th style={styles.th}>Tipo</th>
                  <th style={styles.th}>Seguradora</th>
                  <th style={styles.th}>PF/PJ</th>
                  <th style={styles.th}>Carteira</th>
                  <th style={styles.th}>Vencimento</th>
                  <th style={styles.th}>Prêmio</th>
                  <th style={styles.th}>Status</th>
                  <th style={styles.th}>PDF</th>
                  <th style={styles.th}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {filteredPolicies.map((ap) => (
                  <tr key={ap.id}>
                    <td style={styles.td}>{ap.cliente || "-"}</td>
                    <td style={styles.td}>{ap.empresa_segurad || "-"}</td>
                    <td style={styles.td}>{ap.tipo_seguro || "-"}</td>
                    <td style={styles.td}>{ap.seguradora || "-"}</td>
                    <td style={styles.td}>{ap.tipo_cliente || "-"}</td>
                    <td style={styles.td}>{ap.carteira || "-"}</td>
                    <td style={styles.td}>
                      <span
                        style={{
                          ...styles.badge,
                          ...(isExpired(ap.data_vencimento) &&
                          (ap.status_apolice === "ativa" ||
                            ap.status_apolice === "vencida")
                            ? styles.badgeDanger
                            : styles.badgeNeutral),
                        }}
                      >
                        {formatDate(ap.data_vencimento)}
                      </span>
                    </td>
                    <td style={styles.td}>{currencyBRL(safeNumber(ap.premio))}</td>
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
                      {ap.pdf_url ? (
                        <a
                          href={ap.pdf_url}
                          target="_blank"
                          rel="noreferrer"
                          style={styles.link}
                        >
                          Abrir PDF
                        </a>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td style={styles.td}>
                      <div style={styles.actionButtons}>
                        <button
                          style={styles.actionBtn}
                          onClick={() => handleUpdateStatus(ap.id, "ativa")}
                        >
                          Ativa
                        </button>
                        <button
                          style={styles.actionBtn}
                          onClick={() => handleUpdateStatus(ap.id, "vencida")}
                        >
                          Vencida
                        </button>
                        <button
                          style={styles.actionBtn}
                          onClick={() => handleUpdateStatus(ap.id, "renovada")}
                        >
                          Renovada
                        </button>
                        <button
                          style={styles.actionBtnDanger}
                          onClick={() => handleUpdateStatus(ap.id, "perdida")}
                        >
                          Perdida
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {expiredPolicyModal && (
        <div style={styles.modalOverlay}>
          <div style={styles.modal}>
            <h2 style={styles.modalTitle}>Apólice vencida</h2>

            <p style={styles.modalText}>
              A apólice de <strong>{expiredPolicyModal.cliente || "-"}</strong>{" "}
              venceu em{" "}
              <strong>{formatDate(expiredPolicyModal.data_vencimento)}</strong>.
            </p>

            {renewalMode === "choice" && (
              <>
                <p style={styles.modalText}>
                  Essa apólice foi renovada ou foi perdida para a concorrência?
                </p>

                <div style={styles.modalActions}>
                  <button
                    style={styles.primaryButton}
                    onClick={() => setRenewalMode("renew")}
                  >
                    Foi renovada
                  </button>

                  <button
                    style={styles.dangerButton}
                    onClick={() => setRenewalMode("lost")}
                  >
                    Foi perdida
                  </button>

                  <button
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
                        carteira: e.target.value as
                          | "Alta Renda"
                          | "Empresarial"
                          | "Renovacao",
                      })
                    }
                  >
                    <option value="Alta Renda">Alta Renda</option>
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

                  <input
                    style={styles.input}
                    type="file"
                    accept="application/pdf"
                    onChange={(e) =>
                      setRenewalPdfFile(e.target.files?.[0] || null)
                    }
                  />

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
                    style={styles.primaryButton}
                    onClick={handleRenewPolicy}
                    disabled={saving}
                  >
                    {saving ? "Salvando..." : "Salvar renovação"}
                  </button>

                  <button
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
                    style={styles.dangerButton}
                    onClick={handleLostPolicy}
                    disabled={saving}
                  >
                    {saving ? "Salvando..." : "Confirmar perda"}
                  </button>

                  <button
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
    background: "#f6f7fb",
    minHeight: "100vh",
    color: "#111827",
    fontFamily: "Arial, sans-serif",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 16,
    marginBottom: 24,
  },
  title: {
    margin: 0,
    fontSize: 28,
    fontWeight: 700,
  },
  subtitle: {
    margin: "8px 0 0",
    color: "#6b7280",
  },
  section: {
    background: "#fff",
    borderRadius: 16,
    padding: 20,
    boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
    marginBottom: 20,
  },
  sectionTitle: {
    margin: "0 0 16px 0",
    fontSize: 20,
    fontWeight: 700,
  },
  smallTitle: {
    margin: "0 0 12px 0",
    fontSize: 16,
    fontWeight: 700,
  },
  kpiGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 14,
    marginBottom: 16,
  },
  card: {
    background: "#fff",
    border: "1px solid #e5e7eb",
    borderRadius: 14,
    padding: 16,
  },
  kpiLabel: {
    fontSize: 13,
    color: "#6b7280",
    marginBottom: 8,
  },
  kpiValue: {
    fontSize: 24,
    fontWeight: 700,
  },
  twoColumns: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
    gap: 16,
  },
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  listRow: {
    display: "flex",
    justifyContent: "space-between",
    borderBottom: "1px solid #f1f5f9",
    paddingBottom: 8,
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
    border: "1px solid #d1d5db",
    fontSize: 14,
    outline: "none",
    boxSizing: "border-box",
  },
  primaryButton: {
    border: "none",
    borderRadius: 10,
    padding: "12px 16px",
    background: "#111827",
    color: "#fff",
    cursor: "pointer",
    fontWeight: 700,
  },
  secondaryButton: {
    border: "1px solid #d1d5db",
    borderRadius: 10,
    padding: "12px 16px",
    background: "#fff",
    color: "#111827",
    cursor: "pointer",
    fontWeight: 600,
  },
  dangerButton: {
    border: "none",
    borderRadius: 10,
    padding: "12px 16px",
    background: "#dc2626",
    color: "#fff",
    cursor: "pointer",
    fontWeight: 700,
  },
  actionButtons: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
  },
  actionBtn: {
    border: "1px solid #d1d5db",
    borderRadius: 8,
    padding: "6px 10px",
    background: "#fff",
    cursor: "pointer",
    fontSize: 12,
  },
  actionBtnDanger: {
    border: "1px solid #fecaca",
    borderRadius: 8,
    padding: "6px 10px",
    background: "#fef2f2",
    cursor: "pointer",
    fontSize: 12,
    color: "#b91c1c",
  },
  tableHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    marginBottom: 16,
  },
  tableWrapper: {
    overflowX: "auto",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    minWidth: 1200,
  },
  th: {
    textAlign: "left",
    padding: "12px 10px",
    borderBottom: "1px solid #e5e7eb",
    background: "#f9fafb",
    fontSize: 13,
  },
  td: {
    padding: "12px 10px",
    borderBottom: "1px solid #f3f4f6",
    fontSize: 14,
    verticalAlign: "top",
  },
  badge: {
    display: "inline-block",
    borderRadius: 999,
    padding: "6px 10px",
    fontSize: 12,
    fontWeight: 700,
  },
  badgeSuccess: {
    background: "#dcfce7",
    color: "#166534",
  },
  badgeWarning: {
    background: "#fef3c7",
    color: "#92400e",
  },
  badgeInfo: {
    background: "#dbeafe",
    color: "#1d4ed8",
  },
  badgeDanger: {
    background: "#fee2e2",
    color: "#991b1b",
  },
  badgeNeutral: {
    background: "#f3f4f6",
    color: "#374151",
  },
  link: {
    color: "#2563eb",
    textDecoration: "none",
    fontWeight: 600,
  },
  modalOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.45)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 9999,
    padding: 20,
  },
  modal: {
    width: "100%",
    maxWidth: 820,
    background: "#fff",
    borderRadius: 16,
    padding: 24,
    boxShadow: "0 10px 40px rgba(0,0,0,0.2)",
  },
  modalTitle: {
    margin: "0 0 12px 0",
    fontSize: 22,
    fontWeight: 700,
  },
  modalText: {
    margin: "0 0 12px 0",
    lineHeight: 1.5,
  },
  modalActions: {
    display: "flex",
    gap: 12,
    flexWrap: "wrap",
    marginTop: 16,
  },
  muted: {
    color: "#6b7280",
  },
  errorBox: {
    marginBottom: 16,
    padding: 12,
    borderRadius: 10,
    background: "#fee2e2",
    color: "#991b1b",
    fontWeight: 600,
  },
};