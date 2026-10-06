import { run } from "../fixtures";
import { isActive, latencyChartData, pct, qualityChartData, runLabel } from "../utils";

test("pct formats a fraction", () => expect(pct(0.9167)).toBe("91.7%"));

test("runLabel and isActive", () => {
  expect(runLabel(run(3, "bert", 0.9, 10))).toBe("#3 bert");
  expect(isActive(run(1, "a", 0, 0, "running"))).toBe(true);
  expect(isActive(run(1, "a", 0, 0, "queued"))).toBe(true);
  expect(isActive(run(1, "a", 0.9, 5))).toBe(false);
});

test("qualityChartData pivots metrics per run and skips runs without metrics", () => {
  const data = qualityChartData([run(1, "a", 0.9, 10), run(2, "b", 0.5, 5), run(3, "c", 0, 0, "failed")]);
  expect(data.map((d) => d.metric)).toEqual(["Accuracy", "Precision", "Recall", "F1"]);
  expect(data[3]).toEqual({ metric: "F1", "#1 a": 90, "#2 b": 50 });
});

test("latencyChartData", () => {
  expect(latencyChartData([run(1, "a", 0.9, 12)])).toEqual([{ run: "#1 a", p50: 6, p95: 12 }]);
});
