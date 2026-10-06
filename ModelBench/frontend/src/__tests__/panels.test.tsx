import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { api } from "../api";
import { ModelsPanel } from "../components/ModelsPanel";
import { Playground } from "../components/Playground";
import { RunsPanel } from "../components/RunsPanel";
import { model, run } from "../fixtures";

jest.mock("../api");
const mocked = jest.mocked(api);

beforeEach(() => {
  jest.resetAllMocks();
  mocked.listDatasets.mockResolvedValue([{ name: "sample_sentiment", n_samples: 60 }]);
});

describe("ModelsPanel", () => {
  test("registers a model and clears the form", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    mocked.registerModel.mockResolvedValue(model(9, "new"));
    render(<ModelsPanel models={[]} onChange={onChange} />);

    await user.type(screen.getByPlaceholderText("Display name"), " new ");
    await user.type(screen.getByPlaceholderText(/Hugging Face id/), "org/new");
    await user.click(screen.getByRole("button", { name: "Register model" }));

    expect(mocked.registerModel).toHaveBeenCalledWith({ name: "new", hf_id: "org/new", description: "" });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(screen.getByPlaceholderText("Display name")).toHaveValue("");
  });

  test("shows the server's error, e.g. a duplicate name", async () => {
    const user = userEvent.setup();
    mocked.registerModel.mockRejectedValue(new Error("A model named 'x' already exists"));
    render(<ModelsPanel models={[]} onChange={jest.fn()} />);
    await user.type(screen.getByPlaceholderText("Display name"), "x");
    await user.type(screen.getByPlaceholderText(/Hugging Face id/), "y");
    await user.click(screen.getByRole("button", { name: "Register model" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("already exists");
  });

  test("deletes a model", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    mocked.deleteModel.mockResolvedValue(undefined);
    render(<ModelsPanel models={[model(4, "gone")]} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Delete gone" }));
    expect(mocked.deleteModel).toHaveBeenCalledWith(4);
    await waitFor(() => expect(onChange).toHaveBeenCalled());
  });

  test("delete failure is reported", async () => {
    const user = userEvent.setup();
    mocked.deleteModel.mockRejectedValue(new Error("nope"));
    render(<ModelsPanel models={[model(4, "gone")]} onChange={jest.fn()} />);
    await user.click(screen.getByRole("button", { name: "Delete gone" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("nope");
  });
});

describe("RunsPanel", () => {
  test("only completed runs can be selected; failed runs show their error", async () => {
    const failed = { ...run(2, "bad", 0, 0, "failed"), error: "OSError: model not found" };
    render(<RunsPanel models={[]} runs={[run(1, "ok", 0.9, 5), failed]} selected={[]} onSelect={jest.fn()} onChange={jest.fn()} />);
    expect(screen.getByLabelText("Compare run 1")).toBeEnabled();
    expect(screen.getByLabelText("Compare run 2")).toBeDisabled();
    expect(screen.getByText("OSError: model not found")).toBeInTheDocument();
    await screen.findByText(/sample_sentiment \(60\)/);
  });

  test("toggling a checkbox updates the selection", async () => {
    const user = userEvent.setup();
    const onSelect = jest.fn();
    render(<RunsPanel models={[]} runs={[run(1, "ok", 0.9, 5)]} selected={[7]} onSelect={onSelect} onChange={jest.fn()} />);
    await user.click(screen.getByLabelText("Compare run 1"));
    expect(onSelect).toHaveBeenCalledWith([7, 1]);
  });

  test("uploads a CSV and selects it as the dataset", async () => {
    const user = userEvent.setup();
    mocked.uploadDataset.mockResolvedValue({ name: "mine", n_samples: 3 });
    mocked.listDatasets
      .mockResolvedValueOnce([{ name: "sample_sentiment", n_samples: 60 }])
      .mockResolvedValue([{ name: "sample_sentiment", n_samples: 60 }, { name: "mine", n_samples: 3 }]);
    render(<RunsPanel models={[]} runs={[]} selected={[]} onSelect={jest.fn()} onChange={jest.fn()} />);
    await user.upload(screen.getByLabelText("Upload CSV"), new File(["text,label\na,positive"], "mine.csv", { type: "text/csv" }));
    await waitFor(() => expect(screen.getByLabelText("Dataset")).toHaveValue("mine"));
  });

  test("upload and launch errors are shown", async () => {
    const user = userEvent.setup();
    mocked.uploadDataset.mockRejectedValue(new Error("CSV needs 'text' and 'label' columns"));
    mocked.launchRun.mockRejectedValue(new Error("Model not found"));
    render(<RunsPanel models={[model(1, "m")]} runs={[]} selected={[]} onSelect={jest.fn()} onChange={jest.fn()} />);
    await user.upload(screen.getByLabelText("Upload CSV"), new File(["x"], "bad.csv"));
    expect(await screen.findByRole("alert")).toHaveTextContent("CSV needs");
    await user.selectOptions(screen.getByLabelText("Model"), "1");
    await user.click(screen.getByRole("button", { name: "Launch run" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Model not found");
  });
});

describe("Playground", () => {
  test("classifies text and shows label, confidence and latency", async () => {
    const user = userEvent.setup();
    mocked.predict.mockResolvedValue({ label: "positive", score: 0.987, latency_ms: 23.4 });
    render(<Playground models={[model(1, "distil")]} />);
    await user.selectOptions(screen.getByLabelText("Model"), "1");
    await user.type(screen.getByPlaceholderText(/Type a sentence/), "great film");
    await user.click(screen.getByRole("button", { name: "Classify" }));
    const out = await screen.findByTestId("prediction");
    expect(out).toHaveTextContent("positive");
    expect(out).toHaveTextContent("98.7%");
    expect(out).toHaveTextContent("23.4 ms");
  });

  test("shows an inference error", async () => {
    const user = userEvent.setup();
    mocked.predict.mockRejectedValue(new Error("Inference failed"));
    render(<Playground models={[model(1, "distil")]} />);
    await user.selectOptions(screen.getByLabelText("Model"), "1");
    await user.type(screen.getByPlaceholderText(/Type a sentence/), "x");
    await user.click(screen.getByRole("button", { name: "Classify" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Inference failed");
    expect(screen.queryByTestId("prediction")).not.toBeInTheDocument();
  });
});
