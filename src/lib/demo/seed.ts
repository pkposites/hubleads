// Sample data for demo mode: the "Clínica Exen" workspace from the blueprint
// (§4.2). Timestamps are relative to `now` so the data always looks recent.

export type Row = Record<string, unknown>;
export type DemoDb = Record<string, Row[]>;

export const DEMO_USER_ID = "demo-user";
export const DEMO_USER_EMAIL = "demo@leadhub.app";
export const DEMO_WORKSPACE_SLUG = "clinica-exen";
const CARLA_ID = "demo-carla";
const WS = "ws-exen";

export const DEFAULT_STAGES = [
  { key: "new", name: "Novo", kind: "open", event_type: null },
  { key: "contacted", name: "Contatado", kind: "open", event_type: null },
  { key: "qualified", name: "Qualificado", kind: "open", event_type: "lead.qualified" },
  { key: "scheduled", name: "Agendado", kind: "open", event_type: "lead.scheduled" },
  { key: "won", name: "Venda", kind: "won", event_type: "lead.won" },
  { key: "lost", name: "Perdido", kind: "lost", event_type: "lead.lost" },
] as const;

export function stageRows(workspaceId: string, projectId: string, createdAt: string): Row[] {
  return DEFAULT_STAGES.map((s, i) => ({
    id: `${projectId}:${s.key}`,
    workspace_id: workspaceId,
    project_id: projectId,
    pipeline_id: `${projectId}:pipeline`,
    key: s.key,
    name: s.name,
    position: i + 1,
    kind: s.kind,
    event_type: s.event_type,
    created_at: createdAt,
  }));
}

type Source = "meta" | "google" | "ig" | "gorg" | "direct";

interface SeedLead {
  name: string;
  phone: string;
  email: string | null;
  project: "prj-leticia" | "prj-joao";
  source: Source;
  campaign?: string;
  adId?: string;
  adName?: string;
  answers: Record<string, string>;
  path: string[];
  sale?: number;
  lostReason?: string;
  daysAgo: number;
}

const LEADS: SeedLead[] = [
  { name: "Mariana Costa", phone: "11987654321", email: "mariana.costa@gmail.com", project: "prj-leticia", source: "meta", campaign: "transplante_sp_setembro", adId: "120210456789", adName: "Vídeo antes e depois 01", answers: { budget_range: "R$ 15 a 25 mil", city: "São Paulo", timeframe: "Nos próximos 3 meses" }, path: ["contacted", "qualified", "scheduled", "won"], sale: 18000, daysAgo: 26 },
  { name: "Rafael Oliveira", phone: "11976543210", email: "rafael.oli@hotmail.com", project: "prj-leticia", source: "google", campaign: "transplante_busca_marca", answers: { budget_range: "R$ 10 a 15 mil", city: "Santo André", timeframe: "Ainda pesquisando" }, path: ["contacted", "qualified", "scheduled"], daysAgo: 20 },
  { name: "Juliana Pereira", phone: "11965432109", email: "ju.pereira@outlook.com", project: "prj-leticia", source: "meta", campaign: "transplante_sp_setembro", adId: "120210456790", adName: "Carrossel depoimentos", answers: { budget_range: "Acima de R$ 25 mil", city: "São Paulo", timeframe: "Imediato" }, path: ["contacted", "qualified"], daysAgo: 9 },
  { name: "Carlos Henrique Souza", phone: "11954321098", email: null, project: "prj-leticia", source: "meta", campaign: "transplante_sp_setembro", adId: "120210456789", adName: "Vídeo antes e depois 01", answers: { budget_range: "Até R$ 10 mil", city: "Guarulhos", timeframe: "Ainda pesquisando" }, path: ["contacted", "lost"], lostReason: "Orçamento abaixo do valor do procedimento", daysAgo: 30 },
  { name: "Fernanda Lima", phone: "21998877665", email: "fernanda.lima@gmail.com", project: "prj-leticia", source: "ig", answers: { budget_range: "R$ 15 a 25 mil", city: "Rio de Janeiro", timeframe: "Nos próximos 6 meses" }, path: ["contacted"], daysAgo: 5 },
  { name: "Bruno Almeida", phone: "11943210987", email: "bruno.almeida@empresa.com.br", project: "prj-leticia", source: "google", campaign: "transplante_generico_sp", answers: { budget_range: "R$ 10 a 15 mil", city: "São Paulo", timeframe: "Nos próximos 3 meses" }, path: [], daysAgo: 2 },
  { name: "Patrícia Gomes", phone: "11932109876", email: "patigomes@gmail.com", project: "prj-leticia", source: "meta", campaign: "remarketing_visitantes_lp", adId: "120210456801", adName: "Oferta avaliação gratuita", answers: { budget_range: "R$ 15 a 25 mil", city: "Osasco", timeframe: "Imediato" }, path: [], daysAgo: 1 },
  { name: "Lucas Martins", phone: "11921098765", email: null, project: "prj-leticia", source: "gorg", answers: { budget_range: "Até R$ 10 mil", city: "São Paulo", timeframe: "Ainda pesquisando" }, path: [], daysAgo: 0.3 },
  { name: "Aline Rodrigues", phone: "11910987654", email: "aline.r@gmail.com", project: "prj-joao", source: "meta", campaign: "barba_implante_out", adId: "120210457001", adName: "Reels barba 01", answers: { procedimento: "Implante de barba", city: "São Paulo" }, path: ["contacted", "scheduled"], daysAgo: 12 },
  { name: "Diego Fernandes", phone: "11909876543", email: "diego.f@gmail.com", project: "prj-joao", source: "direct", answers: { procedimento: "Transplante capilar", city: "Campinas" }, path: ["contacted", "qualified", "scheduled", "won"], sale: 22500, daysAgo: 40 },
  { name: "Renata Carvalho", phone: "11998765432", email: "renata.carvalho@yahoo.com.br", project: "prj-joao", source: "google", campaign: "barba_busca", answers: { procedimento: "Implante de sobrancelha", city: "São Paulo" }, path: ["contacted", "lost"], lostReason: "Fechou com outra clínica", daysAgo: 15 },
  { name: "Thiago Ribeiro", phone: "11887766554", email: "thiago.ribeiro@gmail.com", project: "prj-joao", source: "meta", campaign: "barba_implante_out", adId: "120210457002", adName: "Imagem antes e depois", answers: { procedimento: "Implante de barba", city: "Barueri" }, path: [], daysAgo: 0.05 },
];

function touchFor(lead: SeedLead, occurredAt: string, i: number): Row {
  const base = { landing_page_url: "https://clinicaexen.com.br/transplante", occurred_at: occurredAt };
  const campaignName = lead.campaign?.replace(/_/g, " ");
  switch (lead.source) {
    case "meta":
      return {
        channel: "meta_ads",
        utm_source: "facebook",
        utm_medium: "paid",
        utm_campaign: lead.campaign,
        campaign_name: campaignName,
        adset_name: "SP 30-55 interesses",
        ad_id: lead.adId,
        ad_name: lead.adName,
        fbclid: `IwAR3x${lead.adId}`,
        fbc: `fb.1.1727190000.${lead.adId}`,
        fbp: "fb.1.1727180000.987654",
        ...base,
      };
    case "google":
      return {
        channel: "google_ads",
        utm_source: "google",
        utm_medium: "cpc",
        utm_campaign: lead.campaign,
        campaign_name: campaignName,
        gclid: `Cj0KCQjw${(i * 7919).toString(36)}demo`,
        ...base,
      };
    case "ig":
      return { channel: "instagram_organic", utm_source: "instagram", utm_medium: "bio", ...base };
    case "gorg":
      return { channel: "google_organic", referrer: "https://www.google.com.br/", ...base };
    default:
      return { channel: "direct", ...base };
  }
}

export function buildSeed(now: Date): DemoDb {
  const ago = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
  const created = ago(60);

  const db: DemoDb = {
    profiles: [
      { id: DEMO_USER_ID, full_name: "Você (demo)" },
      { id: CARLA_ID, full_name: "Carla (comercial)" },
    ],
    workspaces: [{ id: WS, name: "Clínica Exen", slug: DEMO_WORKSPACE_SLUG, created_at: created }],
    workspace_members: [
      { workspace_id: WS, user_id: DEMO_USER_ID, role: "admin", created_at: created },
      { workspace_id: WS, user_id: CARLA_ID, role: "sales", created_at: created },
    ],
    projects: [
      { id: "prj-leticia", workspace_id: WS, name: "Dra Letícia", slug: "dra-leticia", status: "active", created_at: created },
      { id: "prj-joao", workspace_id: WS, name: "Dr João", slug: "dr-joao", status: "active", created_at: ago(59) },
      { id: "prj-inst", workspace_id: WS, name: "Clínica Exen Institucional", slug: "institucional", status: "active", created_at: ago(58) },
    ],
    pipeline_stages: [
      ...stageRows(WS, "prj-leticia", created),
      ...stageRows(WS, "prj-joao", created),
      ...stageRows(WS, "prj-inst", created),
    ],
    landing_pages: [
      {
        id: "lp-transplante",
        workspace_id: WS,
        project_id: "prj-leticia",
        name: "LP Transplante capilar",
        domains: ["clinicaexen.com.br", "www.clinicaexen.com.br"],
        public_key: "pk_live_demo3c60fe39d8a48009ad318fce7721",
        status: "active",
        created_at: created,
      },
    ],
    forms: [
      {
        id: "frm-transplante",
        workspace_id: WS,
        project_id: "prj-leticia",
        name: "Avaliação de transplante capilar",
        key: "frm_transplante",
        created_at: created,
      },
    ],
    project_api_keys: [
      {
        id: "key-n8n",
        workspace_id: WS,
        project_id: "prj-leticia",
        name: "n8n da clínica",
        key_prefix: "sk_live_Q3vx",
        created_at: created,
        last_used_at: ago(0.1),
        revoked_at: null,
      },
    ],
    leads: [],
    lead_conversions: [],
    lead_stage_history: [],
  };

  LEADS.forEach((seed, i) => {
    const n = i + 1;
    const id = `lead-${n}`;
    const at = ago(seed.daysAgo);
    const touch = touchFor(seed, at, n);
    const stage = (key: string) => `${seed.project}:${key}`;
    const current = seed.path.at(-1) ?? "new";

    db.leads.push({
      id,
      workspace_id: WS,
      project_id: seed.project,
      name: seed.name,
      phone: seed.phone,
      phone_norm: `+55${seed.phone}`,
      email: seed.email,
      email_norm: seed.email,
      current_stage_id: stage(current),
      owner_id: null,
      estimated_value: null,
      sale_value: seed.sale ?? null,
      currency: "BRL",
      lost_reason: current === "lost" ? seed.lostReason : null,
      needs_review: false,
      first_touch: touch,
      last_touch: touch,
      source_channel: touch.channel,
      created_at: at,
      updated_at: at,
    });
    db.lead_conversions.push({
      id: `cnv-${n}`,
      lead_id: id,
      workspace_id: WS,
      project_id: seed.project,
      form_id: seed.project === "prj-leticia" ? "frm-transplante" : null,
      source_channel: touch.channel,
      answers: seed.answers,
      tracking: {},
      consent: { privacy_policy: true, captured_at: at },
      created_at: at,
    });
    db.lead_stage_history.push({
      id: `hist-${n}-0`,
      workspace_id: WS,
      lead_id: id,
      from_stage_id: null,
      to_stage_id: stage("new"),
      changed_by: null,
      metadata: { reason: "created" },
      created_at: at,
    });

    let previous = "new";
    seed.path.forEach((key, step) => {
      const when = new Date(
        new Date(at).getTime() + (step + 1) * Math.min(seed.daysAgo, 3) * 0.25 * 86_400_000,
      ).toISOString();
      db.lead_stage_history.push({
        id: `hist-${n}-${step + 1}`,
        workspace_id: WS,
        lead_id: id,
        from_stage_id: stage(previous),
        to_stage_id: stage(key),
        changed_by: step % 2 === 0 ? CARLA_ID : DEMO_USER_ID,
        metadata: {
          ...(key === "lost" ? { lost_reason: seed.lostReason } : {}),
          ...(key === "won" && seed.sale ? { sale_value: seed.sale } : {}),
        },
        created_at: when,
      });
      previous = key;
    });
  });

  // Mariana converted again through Google: first touch stays Meta, last
  // touch moves to Google (§5.5).
  const mariana = db.leads[0];
  const again = {
    channel: "google_ads",
    utm_source: "google",
    utm_medium: "cpc",
    utm_campaign: "transplante_busca_marca",
    campaign_name: "transplante busca marca",
    gclid: "Cj0KCQjwzv2g3c",
    landing_page_url: "https://clinicaexen.com.br/transplante",
    occurred_at: ago(3),
  };
  mariana.last_touch = again;
  db.lead_conversions.push({
    id: "cnv-1b",
    lead_id: mariana.id,
    workspace_id: WS,
    project_id: "prj-leticia",
    form_id: "frm-transplante",
    source_channel: "google_ads",
    answers: { budget_range: "R$ 15 a 25 mil", city: "São Paulo", timeframe: "Imediato" },
    tracking: {},
    consent: { privacy_policy: true },
    created_at: ago(3),
  });

  return db;
}
