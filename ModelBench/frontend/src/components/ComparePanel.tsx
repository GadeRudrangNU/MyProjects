import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Run } from "../types";
import { latencyChartData, pct, qualityChartData, runLabel } from "../utils";

const PALETTE = ["#4f7cff", "#f5a524", "#17b890", "#e5484d", "#8e6bff", "#14a8c4"];

export function ComparePanel({ runs }: { runs: Run[] }) {
  const done = runs.filter((r) => r.metrics);
  if (done.length === 0) {
    return (
      <section>
        <h2>Compare</h2>
        <p className="muted">Select completed runs on the Runs tab to compare them side by side.</p>
      </section>
    );
  }
  const best = Math.max(...done.map((r) => r.metrics!.f1));

  return (
    <section>
      <h2>Compare</h2>
      <div className="grid">
        <div className="card">
          <h3>Quality (%)</h3>
          <div className="chart" role="img" aria-label="Quality metrics by run">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={qualityChartData(done)}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="metric" />
                <YAxis domain={[0, 100]} />
                <Tooltip />
                <Legend />
                {done.map((r, i) => <Bar key={r.id} dataKey={runLabel(r)} fill={PALETTE[i % PALETTE.length]} radius={[4, 4, 0, 0]} />)}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="card">
          <h3>Latency per request (ms)</h3>
          <div className="chart" role="img" aria-label="Latency by run">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={latencyChartData(done)}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="run" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="p50" fill="#17b890" radius={[4, 4, 0, 0]} />
                <Bar dataKey="p95" fill="#f5a524" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
      <table>
        <thead>
          <tr><th>Run</th><th>Dataset</th><th>Accuracy</th><th>Precision</th><th>Recall</th><th>F1</th><th>p50</th><th>p95</th><th>Throughput</th></tr>
        </thead>
        <tbody>
          {done.map((r) => {
            const m = r.metrics!;
            return (
              <tr key={r.id} className={m.f1 === best ? "best" : ""}>
                <td>{runLabel(r)}</td>
                <td>{r.dataset}</td>
                <td>{pct(m.accuracy)}</td>
                <td>{pct(m.precision)}</td>
                <td>{pct(m.recall)}</td>
                <td>{pct(m.f1)}</td>
                <td>{m.latency_ms.p50} ms</td>
                <td>{m.latency_ms.p95} ms</td>
                <td>{m.throughput_per_s}/s</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
