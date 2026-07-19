import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sidebar, type Page } from "./Sidebar.tsx";
import { Topbar } from "./Topbar.tsx";
import { LeadsPage } from "./LeadsPage.tsx";
import { JobsPage } from "./JobsPage.tsx";
import { EnrichmentPage } from "./EnrichmentPage.tsx";
import { ScoringPage } from "./ScoringPage.tsx";
import { ExportPage } from "./ExportPage.tsx";
import { SettingsPage } from "./SettingsPage.tsx";
import { fetchLeads } from "./api.ts";

const PAGE_META: Record<Page, { title: string; subtitle: string }> = {
  leads: { title: "Lead Dashboard", subtitle: "Businesses scraped from Google Maps" },
  jobs: { title: "Scrape Jobs", subtitle: "Queue and monitor Google Maps scrape runs" },
  enrichment: {
    title: "Enrichment",
    subtitle: "Website crawl for emails, socials, and tech stack",
  },
  scoring: {
    title: "Lead Scoring",
    subtitle: "Ranked leads with rule-based scores and AI explanations",
  },
  export: { title: "Export", subtitle: "Build a filtered CSV of your leads" },
  settings: { title: "Settings", subtitle: "Runtime config, data management, and LLM tools" },
};

export function App() {
  const [page, setPage] = useState<Page>("leads");
  const [leadsJobId, setLeadsJobId] = useState<number | undefined>();

  function navigate(p: Page) {
    setLeadsJobId(undefined); // manual nav to Leads starts unfiltered
    setPage(p);
  }

  const { data: count } = useQuery({
    queryKey: ["leads-count"],
    queryFn: () => fetchLeads({ page_size: 1 }),
    select: (d) => d.total,
  });

  const meta = PAGE_META[page];
  const subtitle =
    page === "leads" && count != null
      ? `${count.toLocaleString()} businesses scraped from Google Maps`
      : meta.subtitle;

  return (
    <div className="shell">
      <div className="card">
        <Sidebar page={page} onNavigate={navigate} />
        <main className="main">
          <Topbar title={meta.title} subtitle={subtitle} />
          {page === "leads" && (
            <LeadsPage key={leadsJobId ?? "all"} initialJobId={leadsJobId} />
          )}
          {page === "jobs" && (
            <JobsPage
              onViewLeads={(id) => {
                setLeadsJobId(id);
                setPage("leads");
              }}
            />
          )}
          {page === "enrichment" && <EnrichmentPage />}
          {page === "scoring" && <ScoringPage />}
          {page === "export" && <ExportPage />}
          {page === "settings" && <SettingsPage />}
        </main>
      </div>
    </div>
  );
}
