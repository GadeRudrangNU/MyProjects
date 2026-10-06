import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App";
import { api } from "../api";
import { model, run } from "../fixtures";

jest.mock("../api");
const mocked = jest.mocked(api);

beforeEach(() => {
  jest.resetAllMocks();
  mocked.listModels.mockResolvedValue([model(1, "distil"), model(2, "baseline")]);
  mocked.listRuns.mockResolvedValue([run(1, "distil", 0.92, 40), run(2, "baseline", 0.7, 1)]);
  mocked.listDatasets.mockResolvedValue([{ name: "sample_sentiment", n_samples: 60 }]);
});

test("lists runs, selects two, and shows the comparison with the best F1 highlighted", async () => {
  const user = userEvent.setup();
  render(<App />);
  expect(await screen.findByText("#1 distil")).toBeInTheDocument();

  await user.click(screen.getByLabelText("Compare run 1"));
  await user.click(screen.getByLabelText("Compare run 2"));
  await user.click(screen.getByRole("tab", { name: /Compare \(2\)/ }));

  expect(screen.getByRole("img", { name: "Quality metrics by run" })).toBeInTheDocument();
  const rows = screen.getAllByRole("row");
  expect(rows.find((r) => r.textContent?.includes("#1 distil"))).toHaveClass("best");
  expect(rows.find((r) => r.textContent?.includes("#2 baseline"))).not.toHaveClass("best");
});

test("compare tab shows a hint when nothing is selected", async () => {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByText("#1 distil");
  await user.click(screen.getByRole("tab", { name: "Compare" }));
  expect(screen.getByText(/Select completed runs/)).toBeInTheDocument();
});

test("launching a run calls the API with the chosen model and dataset", async () => {
  const user = userEvent.setup();
  mocked.launchRun.mockResolvedValue(run(3, "distil", 0, 0, "queued"));
  render(<App />);
  await screen.findByText("#1 distil");
  await user.selectOptions(screen.getByLabelText("Model"), "1");
  await user.click(screen.getByRole("button", { name: "Launch run" }));
  expect(mocked.launchRun).toHaveBeenCalledWith(1, "sample_sentiment");
});

test("shows an error banner when the API is down", async () => {
  mocked.listModels.mockRejectedValue(new Error("boom"));
  render(<App />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Cannot reach the API: boom");
});

test("polls while a run is active", async () => {
  jest.useFakeTimers();
  mocked.listRuns.mockResolvedValue([run(1, "distil", 0, 0, "running")]);
  render(<App />);
  await screen.findByText("running"); // interval is only registered once an active run is rendered
  await act(async () => { jest.advanceTimersByTime(1600); });
  expect(mocked.listRuns.mock.calls.length).toBeGreaterThanOrEqual(2);
  jest.useRealTimers();
});
