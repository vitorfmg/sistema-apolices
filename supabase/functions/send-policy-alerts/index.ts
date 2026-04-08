import { createClient } from 'npm:@supabase/supabase-js@2';
import { Resend } from 'npm:resend';

type Policy = {
  id: string;
  cliente: string | null;
  empresa_segurada: string | null;
  tipo_seguro: string | null;
  seguradora: string | null;
  data_vencimento: string | null;
  premio: number | null;
  origem: string | null;
  observacoes: string | null;
};

type Recipient = {
  email: string;
};

type AlertType = 'vencido' | 'vence_15' | 'vence_30' | 'vence_45';

type PolicyWithAlert = {
  policy: Policy;
  days: number | null;
  alertType: AlertType;
};

function formatDateBR(value: string | null) {
  if (!value) return '-';
  const [yyyy, mm, dd] = value.split('-');
  if (!yyyy || !mm || !dd) return value;
  return `${dd}/${mm}/${yyyy}`;
}

function formatCurrency(value: number | null) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(Number(value || 0));
}

function getDaysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;

  const today = new Date();
  const todayZero = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  const due = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(due.getTime())) return null;

  const dueZero = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const diffMs = dueZero.getTime() - todayZero.getTime();

  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

function getAlertType(days: number | null): AlertType | null {
  if (days === null) return null;
  if (days < 0) return 'vencido';
  if (days === 15) return 'vence_15';
  if (days === 30) return 'vence_30';
  if (days === 45) return 'vence_45';
  return null;
}

function getAlertLabel(alertType: AlertType) {
  switch (alertType) {
    case 'vence_45':
      return 'Vencem em 45 dias';
    case 'vence_30':
      return 'Vencem em 30 dias';
    case 'vence_15':
      return 'Vencem em 15 dias';
    case 'vencido':
      return 'Apólices vencidas';
  }
}

function getAlertDescription(alertType: AlertType) {
  switch (alertType) {
    case 'vence_45':
      return 'As apólices abaixo vencem em 45 dias.';
    case 'vence_30':
      return 'As apólices abaixo vencem em 30 dias.';
    case 'vence_15':
      return 'As apólices abaixo vencem em 15 dias.';
    case 'vencido':
      return 'As apólices abaixo já estão vencidas.';
  }
}

function buildGroupedEmailHtml(alertType: AlertType, items: PolicyWithAlert[]) {
  const title = getAlertLabel(alertType);
  const description = getAlertDescription(alertType);

  const rows = items
    .map(({ policy, days }) => {
      const empresa = policy.empresa_segurada || '-';
      const cliente = policy.cliente || '-';
      const tipo = policy.tipo_seguro || '-';
      const seguradora = policy.seguradora || '-';
      const vencimento = formatDateBR(policy.data_vencimento);
      const premio = formatCurrency(policy.premio);
      const origem = policy.origem || '-';

      const statusText =
        alertType === 'vencido'
          ? `Vencida há ${Math.abs(days || 0)} dia(s)`
          : `Vence em ${days} dia(s)`;

      return `
        <tr>
          <td style="padding: 10px; border: 1px solid #ddd;">${empresa}</td>
          <td style="padding: 10px; border: 1px solid #ddd;">${cliente}</td>
          <td style="padding: 10px; border: 1px solid #ddd;">${tipo}</td>
          <td style="padding: 10px; border: 1px solid #ddd;">${seguradora}</td>
          <td style="padding: 10px; border: 1px solid #ddd;">${vencimento}</td>
          <td style="padding: 10px; border: 1px solid #ddd;">${premio}</td>
          <td style="padding: 10px; border: 1px solid #ddd;">${origem}</td>
          <td style="padding: 10px; border: 1px solid #ddd;">${statusText}</td>
        </tr>
      `;
    })
    .join('');

  return `
    <div style="font-family: Arial, sans-serif; color: #111; line-height: 1.5;">
      <h2 style="margin-bottom: 8px;">${title}</h2>
      <p style="margin-bottom: 20px;">${description}</p>

      <table style="border-collapse: collapse; width: 100%; max-width: 1000px;">
        <thead>
          <tr style="background-color: #f5f5f5;">
            <th style="padding: 10px; border: 1px solid #ddd; text-align: left;">Empresa segurada</th>
            <th style="padding: 10px; border: 1px solid #ddd; text-align: left;">Cliente</th>
            <th style="padding: 10px; border: 1px solid #ddd; text-align: left;">Tipo</th>
            <th style="padding: 10px; border: 1px solid #ddd; text-align: left;">Seguradora</th>
            <th style="padding: 10px; border: 1px solid #ddd; text-align: left;">Vencimento</th>
            <th style="padding: 10px; border: 1px solid #ddd; text-align: left;">Prêmio</th>
            <th style="padding: 10px; border: 1px solid #ddd; text-align: left;">Origem</th>
            <th style="padding: 10px; border: 1px solid #ddd; text-align: left;">Status</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>

      <p style="margin-top: 20px;">Sistema de Acompanhamento de Seguros</p>
    </div>
  `;
}

Deno.serve(async () => {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const resendApiKey = Deno.env.get('RESEND_API_KEY')!;
    const fromEmail = Deno.env.get('ALERT_FROM_EMAIL')!;

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const resend = new Resend(resendApiKey);

    const referenceDate = new Date().toISOString().slice(0, 10);

    const { data: policies, error: policiesError } = await supabase
      .from('policies')
      .select('*');

    if (policiesError) throw policiesError;

    const { data: recipients, error: recipientsError } = await supabase
      .from('email_alert_recipients')
      .select('email')
      .eq('active', true);

    if (recipientsError) throw recipientsError;

    const duePolicies: PolicyWithAlert[] = (policies || [])
      .map((policy: Policy) => {
        const days = getDaysUntil(policy.data_vencimento);
        const alertType = getAlertType(days);

        if (!alertType) return null;

        return {
          policy,
          days,
          alertType,
        };
      })
      .filter((item): item is PolicyWithAlert => item !== null);

    const grouped: Record<AlertType, PolicyWithAlert[]> = {
      vencido: [],
      vence_15: [],
      vence_30: [],
      vence_45: [],
    };

    for (const item of duePolicies) {
      grouped[item.alertType].push(item);
    }

    let sentCount = 0;
    let skippedCount = 0;
    let logCount = 0;
    const errors: string[] = [];

    for (const recipient of (recipients || []) as Recipient[]) {
      for (const alertType of Object.keys(grouped) as AlertType[]) {
        const items = grouped[alertType];

        if (!items.length) continue;

        const pendingItems: PolicyWithAlert[] = [];

        for (const item of items) {
          const { data: existingLog, error: existingLogError } = await supabase
            .from('policy_alert_logs')
            .select('id')
            .eq('policy_id', item.policy.id)
            .eq('alert_type', alertType)
            .eq('recipient_email', recipient.email)
            .eq('reference_date', referenceDate)
            .maybeSingle();

          if (existingLogError) throw existingLogError;

          if (existingLog) {
            skippedCount++;
            continue;
          }

          pendingItems.push(item);
        }

        if (!pendingItems.length) continue;

        const subject = `${getAlertLabel(alertType)} - ${pendingItems.length} apólice(s)`;

        const response = await resend.emails.send({
          from: fromEmail,
          to: recipient.email,
          subject,
          html: buildGroupedEmailHtml(alertType, pendingItems),
        });

        if ((response as any).error) {
          const errorMessage =
            (response as any).error.message || 'Erro ao enviar e-mail consolidado';

          errors.push(`${alertType} -> ${recipient.email}: ${errorMessage}`);

          for (const item of pendingItems) {
            const { error: logError } = await supabase
              .from('policy_alert_logs')
              .insert({
                policy_id: item.policy.id,
                alert_type: alertType,
                sent_to: recipient.email,
                recipient_email: recipient.email,
                reference_date: referenceDate,
                status: 'error',
                error_message: errorMessage,
                policy_name: item.policy.empresa_segurada || item.policy.cliente || 'Sem nome',
              });

            if (logError) throw logError;
            logCount++;
          }

          continue;
        }

        sentCount++;

        for (const item of pendingItems) {
          const { error: logError } = await supabase
            .from('policy_alert_logs')
            .insert({
              policy_id: item.policy.id,
              alert_type: alertType,
              sent_to: recipient.email,
              recipient_email: recipient.email,
              reference_date: referenceDate,
              status: 'sent',
              error_message: null,
              policy_name: item.policy.empresa_segurada || item.policy.cliente || 'Sem nome',
            });

          if (logError) throw logError;
          logCount++;
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        sentCount,
        skippedCount,
        logCount,
        checkedPolicies: policies?.length || 0,
        errors,
      }),
      {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }),
      {
        headers: { 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});