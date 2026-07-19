import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createJob, deleteJobData, fetchJobs, type Job } from "./api.ts";

const ACTIVE = new Set(["pending", "running"]);

export function JobsPage({
  onViewLeads,
}: {
  onViewLeads?: (jobId: number) => void;
}) {
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [city, setCity] = useState("");
  const [maxResults, setMaxResults] = useState(120);

  const { data } = useQuery({
    queryKey: ["jobs"],
    queryFn: fetchJobs,
    refetchInterval: (q) => {
      const items = q.state.data?.items ?? [];
      return items.some((j: Job) => ACTIVE.has(j.status)) ? 3000 : false;
    },
  });

  const mutation = useMutation({
    mutationFn: createJob,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["jobs"] }),
  });

  const wipeData = useMutation({
    mutationFn: deleteJobData,
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["leads-count"] });
      alert(
        `Deleted ${res.deleted_leads} lead(s); ` +
          `${res.unlinked_shared} shared lead(s) kept (still linked to other jobs).`,
      );
    },
  });

  const jobs = data?.items ?? [];

  return (
    <div className="panel">
      <div className="panel-head">
        <h3>Scrape Jobs</h3>
      </div>

      <div className="toolbar">
        <input
          placeholder='Query e.g. "software company in Dhaka"'
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ minWidth: 320 }}
        />
        <input
          placeholder="City"
          value={city}
          onChange={(e) => setCity(e.target.value)}
        />
        <input
          type="number"
          value={maxResults}
          min={1}
          max={500}
          onChange={(e) => setMaxResults(Number(e.target.value))}
          style={{ width: 90 }}
        />
        <button
          className="btn"
          disabled={query.trim().length < 3 || mutation.isPending}
          onClick={() =>
            mutation.mutate({
              query: query.trim(),
              city: city.trim() || undefined,
              max_results: maxResults,
            })
          }
        >
          Queue scrape
        </button>
        <span className="muted count">Scraper poller picks up pending jobs.</span>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Query</th>
              <th>City</th>
              <th>Status</th>
              <th>Saved</th>
              <th>Created</th>
              <th>Error</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id}>
                <td>{j.id}</td>
                <td>{j.params.query}</td>
                <td>{j.params.city ?? "—"}</td>
                <td className={`status-${j.status}`}>{j.status}</td>
                <td>{j.progress}</td>
                <td>{j.created_at ? new Date(j.created_at).toLocaleString() : "—"}</td>
                <td className="muted">{j.error ?? ""}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {j.type === "scrape" && (
                    <>
                      <a
                        className="btn secondary"
                        href={`/api/export.csv?job_id=${j.id}`}
                      >
                        CSV
                      </a>{" "}
                      <button
                        className="btn secondary"
                        onClick={() => onViewLeads?.(j.id)}
                      >
                        Leads
                      </button>{" "}
                      <button
                        className="btn secondary"
                        disabled={wipeData.isPending}
                        onClick={() => {
                          if (
                            confirm(
                              `Delete all data scraped by job #${j.id} (“${j.params.query}”)? ` +
                                `Leads also found by other jobs are kept.`,
                            )
                          )
                            wipeData.mutate(j.id);
                        }}
                      >
                        Delete data
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {jobs.length === 0 && (
              <tr>
                <td colSpan={8} className="muted">
                  No jobs yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
