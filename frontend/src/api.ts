export interface Lead {
  id: number;
  place_key: string;
  name: string;
  main_category: string | null;
  categories: string[] | null;
  address: string | null;
  city: string | null;
  phone: string | null;
  website: string | null;
  rating: number | null;
  reviews_count: number | null;
  socials: Record<string, string> | null;
  source_query: string | null;
  scraped_at: string | null;
}

export interface LeadsResponse {
  total: number;
  page: number;
  page_size: number;
  items: Lead[];
}

export interface Job {
  id: number;
  type: string;
  params: { query?: string; city?: string; max_results?: number };
  status: string;
  progress: number;
  error: string | null;
  created_at: string | null;
  finished_at: string | null;
}

export interface LeadFilters {
  city?: string;
  category?: string;
  has_website?: boolean;
  has_phone?: boolean;
  min_rating?: number;
  search?: string;
  job_id?: number;
  sort?: string;
  order?: string;
  page?: number;
  page_size?: number;
}

export function buildQuery(filters: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "" && value !== null) {
      params.set(key, String(value));
    }
  }
  return params.toString();
}

export async function fetchLeads(filters: LeadFilters): Promise<LeadsResponse> {
  const res = await fetch(`/api/leads?${buildQuery(filters as Record<string, unknown>)}`);
  if (!res.ok) throw new Error(`leads fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchJobs(): Promise<{ items: Job[] }> {
  const res = await fetch("/api/jobs?limit=25");
  if (!res.ok) throw new Error(`jobs fetch failed: ${res.status}`);
  return res.json();
}

export async function createJob(body: {
  query: string;
  city?: string;
  max_results?: number;
}): Promise<Job> {
  const res = await fetch("/api/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`job create failed: ${res.status}`);
  return res.json();
}

export async function deleteLead(id: number): Promise<{ deleted: number }> {
  const res = await fetch(`/api/leads/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`lead delete failed: ${res.status}`);
  return res.json();
}

export async function deleteJobData(
  jobId: number,
): Promise<{ deleted_leads: number; unlinked_shared: number }> {
  const res = await fetch(`/api/jobs/${jobId}/data`, { method: "DELETE" });
  if (!res.ok) throw new Error(`job data delete failed: ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Enrichment
// ---------------------------------------------------------------------------

export interface Enrichment {
  id: number;
  name: string;
  website: string | null;
  city: string | null;
  main_category: string | null;
  status: string | null;
  emails: string[] | null;
  socials: Record<string, string> | null;
  tech_stack: string[] | null;
  crawled_at: string | null;
}

export interface EnrichmentResponse {
  total: number;
  page: number;
  page_size: number;
  items: Enrichment[];
}

export interface EnrichmentFilters {
  search?: string;
  city?: string;
  category?: string;
  status?: string;
  min_emails?: number;
  page?: number;
  page_size?: number;
}

export async function fetchEnrichments(
  filters: EnrichmentFilters,
): Promise<EnrichmentResponse> {
  const res = await fetch(
    `/api/enrichments?${buildQuery(filters as Record<string, unknown>)}`,
  );
  if (!res.ok) throw new Error(`enrichments fetch failed: ${res.status}`);
  return res.json();
}

export async function createEnrichJob(body: {
  business_ids?: number[];
  filter?: LeadFilters;
  max?: number;
}): Promise<{ id: number }> {
  const res = await fetch("/api/jobs/enrich", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`enrich job create failed: ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export interface ScoreFactor {
  name: string;
  weight: number;
  raw: number | boolean | null;
  contribution: number;
}

export interface ScoredLead {
  id: number;
  name: string;
  main_category: string | null;
  city: string | null;
  rating: number | null;
  reviews_count: number | null;
  website: string | null;
  score: number | null;
  factors: ScoreFactor[] | null;
  llm_summary: string | null;
  has_llm: boolean;
  scored_at: string | null;
}

export interface ScoresResponse {
  total: number;
  page: number;
  page_size: number;
  items: ScoredLead[];
}

export interface ScoreFilters {
  search?: string;
  city?: string;
  min_score?: number;
  has_llm?: boolean;
  page?: number;
  page_size?: number;
}

export async function fetchScores(filters: ScoreFilters): Promise<ScoresResponse> {
  const res = await fetch(`/api/scores?${buildQuery(filters as Record<string, unknown>)}`);
  if (!res.ok) throw new Error(`scores fetch failed: ${res.status}`);
  return res.json();
}

export async function createScoreJob(body: {
  business_ids?: number[];
  filter?: LeadFilters;
  max?: number;
  explain?: boolean;
}): Promise<{ id: number }> {
  const res = await fetch("/api/jobs/score", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`score job create failed: ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface SettingsData {
  database_url: string;
  llm: {
    format: string;
    base_url: string;
    model: string;
    api_key_present: boolean;
    api_key_masked: string;
    configured: boolean;
  };
  scrape: {
    delay_min_s: number;
    delay_max_s: number;
    daily_cap: number;
    cooldown_hours: number;
    headless: boolean;
    editable: string[];
  };
  counts: {
    leads: number;
    with_website: number;
    enrichments: number;
    scores: number;
    scores_with_llm: number;
  };
}

export async function fetchSettings(): Promise<SettingsData> {
  const res = await fetch("/api/settings");
  if (!res.ok) throw new Error(`settings fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchQueueHealth(): Promise<{
  breakdown: Record<string, Record<string, number>>;
}> {
  const res = await fetch("/api/settings/queue");
  if (!res.ok) throw new Error(`queue fetch failed: ${res.status}`);
  return res.json();
}

export async function patchScrapeKnobs(body: {
  delay_min_s?: number;
  delay_max_s?: number;
  daily_cap?: number;
}): Promise<{ ok: boolean; scrape: SettingsData["scrape"] }> {
  const res = await fetch("/api/settings/scrape", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`scrape knobs update failed: ${res.status}`);
  return res.json();
}

export async function llmTest(
  prompt: string,
): Promise<{
  ok: boolean;
  error?: string;
  format?: string;
  model?: string;
  latency_ms?: number;
  usage?: { input: number | null; output: number | null };
  reply?: string;
}> {
  const res = await fetch("/api/settings/llm-test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  if (!res.ok) throw new Error(`llm test failed: ${res.status}`);
  return res.json();
}

export async function retryFailed(): Promise<{ ok: boolean; requeued: number }> {
  const res = await fetch("/api/settings/retry-failed", { method: "POST" });
  if (!res.ok) throw new Error(`retry failed failed: ${res.status}`);
  return res.json();
}

export async function rescoreAll(): Promise<{
  ok: boolean;
  job_id: number;
  total_businesses: number;
}> {
  const res = await fetch("/api/settings/rescore-all", { method: "POST" });
  if (!res.ok) throw new Error(`rescore-all failed: ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Export (enhanced)
// ---------------------------------------------------------------------------

export function exportCsvUrl(
  filters: LeadFilters,
  opts?: {
    columns?: string[];
    include_score?: boolean;
    include_enrichment?: boolean;
  },
): string {
  const { sort, order, page, page_size, ...rest } = filters;
  void sort;
  void order;
  void page;
  void page_size;
  const params = buildQuery(rest as Record<string, unknown>);
  const extra: string[] = [];
  if (opts?.columns && opts.columns.length > 0)
    extra.push(`columns=${encodeURIComponent(opts.columns.join(","))}`);
  if (opts?.include_score) extra.push("include_score=true");
  if (opts?.include_enrichment) extra.push("include_enrichment=true");
  const sep = params ? "&" : "";
  return `/api/export.csv?${params}${sep}${extra.join("&")}`;
}
