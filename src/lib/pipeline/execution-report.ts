import type { ExecutionReport } from "@/types";

function esc(s: unknown): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

function rows(obj: Record<string, unknown>): string {
  return Object.entries(obj)
    .map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`)
    .join("");
}

/** Legacy `D0000dti.html` equivalent (architecture section 10.6). */
export function renderExecutionReportHtml(r: ExecutionReport): string {
  const ruleRows = r.rules
    .map((t) => `<tr><td>${esc(t.ruleId)}</td><td>${esc(t.level)}</td><td>${t.evaluations}</td><td>${t.findings}</td><td>${t.durationMs}</td></tr>`)
    .join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Execution Report ${esc(r.batchId)}</title>
<style>body{font-family:system-ui,sans-serif;margin:2rem;color:#111}table{border-collapse:collapse;margin:1rem 0}th,td{border:1px solid #ccc;padding:.3rem .6rem;text-align:left;font-size:.9rem}th{background:#f4f4f4}h1,h2{font-weight:600}.status{display:inline-block;padding:.2rem .6rem;border-radius:.3rem;background:#eee}</style>
</head><body>
<h1>Execution Report</h1>
<p>Batch <code>${esc(r.batchId)}</code> &mdash; status <span class="status">${esc(r.status)}</span></p>
<h2>Execution</h2><table>${rows({ startedAt: r.startedAt, endedAt: r.endedAt, durationMs: r.durationMs, ...(r.failureReason ? { failureReason: r.failureReason } : {}) })}</table>
<h2>Parameters</h2><table>${rows(r.parameters)}</table>
<h2>Input file</h2><table>${rows(r.input)}</table>
<h2>Counts</h2><table>${rows(r.counts)}</table>
<h2>Outputs</h2><ul>${r.outputs.map((o) => `<li><code>${esc(o)}</code></li>`).join("")}</ul>
<h2>Rule timings</h2><table><thead><tr><th>Rule</th><th>Level</th><th>Evaluations</th><th>Findings</th><th>Duration (ms)</th></tr></thead><tbody>${ruleRows}</tbody></table>
</body></html>
`;
}
