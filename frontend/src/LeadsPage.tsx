import { useMemo, useState } from "react";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  deleteLead,
  exportCsvUrl,
  fetchJobs,
  fetchLeads,
  type Job,
  type Lead,
  type LeadFilters,
} from "./api.ts";
import { LeadDrawer } from "./LeadDrawer.tsx";
import { ChevronLeft, ChevronRight } from "./icons.tsx";

const columnHelper = createColumnHelper<Lead>();

const columns = [
  columnHelper.accessor("name", { header: "Name" }),
  columnHelper.accessor("main_category", {
    header: "Category",
    cell: (c) => c.getValue() ?? <span className="muted">—</span>,
  }),
  columnHelper.accessor("address", {
    header: "Address",
    cell: (c) => c.getValue() ?? <span className="muted">—</span>,
  }),
  columnHelper.accessor("city", {
    header: "City",
    cell: (c) => c.getValue() ?? <span className="muted">—</span>,
  }),
  columnHelper.accessor("phone", {
    header: "Phone",
    cell: (c) => c.getValue() ?? <span className="muted">—</span>,
  }),
  columnHelper.accessor("website", {
    header: "Website",
    cell: (c) =>
      c.getValue() ? (
        <a
          href={c.getValue()!}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
        >
          link
        </a>
      ) : (
        <span className="muted">—</span>
      ),
  }),
  columnHelper.accessor("rating", {
    header: "Rating",
    cell: (c) =>
      c.getValue() != null ? (
        <span className="rating-chip">
          <span className="star">★</span>
          {c.getValue()}
        </span>
      ) : (
        <span className="muted">—</span>
      ),
  }),
];

const PAGE_SIZE = 25;

function pageList(current: number, max: number): (number | "…")[] {
  if (max <= 7) return Array.from({ length: max }, (_, i) => i + 1);
  const out: (number | "…")[] = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(max - 1, current + 1);
  if (start > 2) out.push("…");
  for (let i = start; i <= end; i++) out.push(i);
  if (end < max - 1) out.push("…");
  out.push(max);
  return out;
}

export function LeadsPage({ initialJobId }: { initialJobId?: number }) {
  const qc = useQueryClient();
  const [filters, setFilters] = useState<LeadFilters>({
    sort: "scraped_at",
    order: "desc",
    page: 1,
    page_size: PAGE_SIZE,
    job_id: initialJobId,
  });
  const [selected, setSelected] = useState<Lead | null>(null);

  const { data, isFetching } = useQuery({
    queryKey: ["leads", filters],
    queryFn: () => fetchLeads(filters),
    placeholderData: keepPreviousData,
  });

  const { data: jobsData } = useQuery({ queryKey: ["jobs"], queryFn: fetchJobs });
  const scrapeJobs = (jobsData?.items ?? []).filter(
    (j: Job) => j.type === "scrape",
  );

  const removeLead = useMutation({
    mutationFn: deleteLead,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["leads-count"] });
    },
  });

  const rows = useMemo(() => data?.items ?? [], [data]);

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
  });

  const total = data?.total ?? 0;
  const page = filters.page ?? 1;
  const maxPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function patch(next: Partial<LeadFilters>) {
    setFilters((f) => ({ ...f, ...next, page: 1 }));
  }
  function goTo(p: number) {
    setFilters((f) => ({ ...f, page: p }));
  }
  function toggleSort(colId: string) {
    setFilters((f) => ({
      ...f,
      sort: colId,
      order: f.sort === colId && f.order === "asc" ? "desc" : "asc",
      page: 1,
    }));
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <h3>Business Leads</h3>
        <div className="right">
          <a className="btn secondary" href={exportCsvUrl(filters)}>
            Export CSV
          </a>
        </div>
      </div>

      <div className="toolbar">
        <input
          placeholder="Search name / address…"
          defaultValue={filters.search ?? ""}
          onKeyDown={(e) => {
            if (e.key === "Enter")
              patch({ search: (e.target as HTMLInputElement).value });
          }}
        />
        <input
          placeholder="City"
          defaultValue={filters.city ?? ""}
          onKeyDown={(e) => {
            if (e.key === "Enter")
              patch({ city: (e.target as HTMLInputElement).value });
          }}
        />
        <input
          placeholder="Category"
          defaultValue={filters.category ?? ""}
          onKeyDown={(e) => {
            if (e.key === "Enter")
              patch({ category: (e.target as HTMLInputElement).value });
          }}
        />
        <label className="check">
          <input
            type="checkbox"
            checked={filters.has_website ?? false}
            onChange={(e) => patch({ has_website: e.target.checked || undefined })}
          />
          has website
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={filters.has_phone ?? false}
            onChange={(e) => patch({ has_phone: e.target.checked || undefined })}
          />
          has phone
        </label>
        <select
          value={filters.min_rating ?? ""}
          onChange={(e) =>
            patch({ min_rating: e.target.value ? Number(e.target.value) : undefined })
          }
        >
          <option value="">any rating</option>
          <option value="3">3+</option>
          <option value="4">4+</option>
          <option value="4.5">4.5+</option>
        </select>
        <select
          value={filters.job_id ?? ""}
          onChange={(e) =>
            patch({ job_id: e.target.value ? Number(e.target.value) : undefined })
          }
        >
          <option value="">any job</option>
          {scrapeJobs.map((j) => (
            <option key={j.id} value={j.id}>
              #{j.id} — {j.params.query}
            </option>
          ))}
        </select>
        <span className="count">{isFetching ? "…" : `${total} leads`}</span>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => (
                  <th key={h.id} onClick={() => toggleSort(h.column.id)}>
                    {flexRender(h.column.columnDef.header, h.getContext())}
                    {filters.sort === h.column.id
                      ? filters.order === "asc"
                        ? " ▲"
                        : " ▼"
                      : ""}
                  </th>
                ))}
                <th style={{ width: 72 }} />
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} onClick={() => setSelected(row.original)}>
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
                <td>
                  <button
                    className="dots-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelected(row.original);
                    }}
                    title="Details"
                  >
                    ⋯
                  </button>
                  <button
                    className="dots-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Delete lead "${row.original.name}"?`))
                        removeLead.mutate(row.original.id);
                    }}
                    title="Delete lead"
                  >
                    🗑
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && !isFetching && (
              <tr>
                <td colSpan={columns.length + 1} className="muted">
                  No leads match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="pager">
        <button
          className="page-pill nav"
          disabled={page <= 1}
          onClick={() => goTo(page - 1)}
        >
          <ChevronLeft />
        </button>
        {pageList(page, maxPage).map((p, i) =>
          p === "…" ? (
            <span key={`e${i}`} className="page-ellipsis">
              …
            </span>
          ) : (
            <button
              key={p}
              className={`page-pill ${p === page ? "active" : ""}`}
              onClick={() => goTo(p)}
            >
              {p}
            </button>
          ),
        )}
        <button
          className="page-pill nav"
          disabled={page >= maxPage}
          onClick={() => goTo(page + 1)}
        >
          <ChevronRight />
        </button>
      </div>

      {selected && <LeadDrawer lead={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
