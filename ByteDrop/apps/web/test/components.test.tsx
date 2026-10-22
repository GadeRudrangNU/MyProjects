import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/ui/toast";
import { DEMO_PROJECT_ID, demoState } from "@/lib/demo/data";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh, replace: vi.fn() }),
  usePathname: () => "/p/x/files",
  useSearchParams: () => new URLSearchParams(),
}));

import { AuthForm } from "@/components/auth-form";
import { ShareDialog } from "@/components/files/share-dialog";
import { KeysPanel } from "@/components/keys/keys-panel";
import { Playground } from "@/components/playground/playground";

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>{ui}</ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  push.mockClear();
  refresh.mockClear();
});

describe("AuthForm", () => {
  it("explains what is wrong before sending anything", async () => {
    const user = userEvent.setup();
    wrap(<AuthForm mode="login" />);
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Enter a valid email address")).toBeInTheDocument();
    expect(screen.getByText("Use at least 8 characters")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("requires a name when signing up and goes to the projects page on success", async () => {
    const user = userEvent.setup();
    wrap(<AuthForm mode="signup" />);
    await user.type(screen.getByLabelText("Email"), "new@example.com");
    await user.type(screen.getByLabelText("Password"), "long-enough-password");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByText("Enter your name")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Name"), "New Person");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/projects"));
  });
});

describe("ShareDialog", () => {
  const item = demoState().objects["acme-private"]![0]!;

  it("creates a signed link for a private bucket with the chosen expiry and copies it", async () => {
    const user = userEvent.setup();
    const copy = vi.spyOn(navigator.clipboard, "writeText");
    wrap(<ShareDialog projectId={DEMO_PROJECT_ID} bucket="acme-private" isPublic={false} item={item} onClose={() => {}} />);

    expect(screen.queryByLabelText("Link", { exact: true })).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Link expires after"), "24 hours");
    await user.click(screen.getByRole("button", { name: /Create link/ }));

    const input = (await screen.findByLabelText("Link", { exact: true })) as HTMLInputElement;
    expect(input.value).toMatch(/\/f\/acme-private\/invoices\/2025-09\.pdf\?exp=\d+&sig=/);
    const exp = Number(/exp=(\d+)/.exec(input.value)![1]);
    expect(exp - Math.floor(Date.now() / 1000)).toBeGreaterThan(86_000);
    expect(exp - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(86_400);

    await user.click(screen.getByRole("button", { name: /Copy link/ }));
    await waitFor(() => expect(copy).toHaveBeenCalledWith(input.value));
  });

  it("offers a permanent link, without an expiry picker, for public buckets", () => {
    wrap(<ShareDialog projectId={DEMO_PROJECT_ID} bucket="acme-assets" isPublic item={demoState().objects["acme-assets"]![0]!} onClose={() => {}} />);
    expect(screen.queryByLabelText("Link expires after")).not.toBeInTheDocument();
    expect((screen.getByLabelText("Link", { exact: true }) as HTMLInputElement).value).toContain("/f/acme-assets/");
  });
});

describe("KeysPanel", () => {
  it("shows the secret once, lists the new key and revokes it", async () => {
    const user = userEvent.setup();
    wrap(<KeysPanel projectId={DEMO_PROJECT_ID} keys={demoState().keys[DEMO_PROJECT_ID]!} />);

    await user.click(screen.getByRole("button", { name: "Create API key" }));
    await user.type(screen.getByLabelText("Name"), "unit test key");
    await user.selectOptions(screen.getByLabelText("Permissions"), "write");
    await user.click(screen.getByRole("button", { name: "Create key" }));

    const secret = ((await screen.findByLabelText("Secret", { exact: true })) as HTMLInputElement).value;
    expect(secret).toMatch(/^bd_live_/);
    await user.click(screen.getByRole("button", { name: "I have saved it" }));
    await waitFor(() => expect(screen.queryByDisplayValue(secret)).not.toBeInTheDocument());
    expect(document.body.textContent).not.toContain(secret);

    const row = await screen.findByRole("row", { name: /unit test key/ });
    expect(within(row).getByText("Read + write")).toBeInTheDocument();

    await user.click(within(row).getByRole("button", { name: "Revoke unit test key" }));
    await user.click(screen.getByRole("button", { name: "Revoke key" }));
    await waitFor(() => expect(within(screen.getByRole("row", { name: /unit test key/ })).getByText("Revoked")).toBeInTheDocument());
  });

  it("validates the form", async () => {
    const user = userEvent.setup();
    wrap(<KeysPanel projectId={DEMO_PROJECT_ID} keys={[]} />);
    expect(screen.getByText("No API keys yet")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Create API key" }));
    await user.click(screen.getByRole("button", { name: "Create key" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});

describe("Playground", () => {
  const images = demoState().objects["acme-assets"]!.filter((o) => o.kind === "image");

  it("builds the transform URL from the controls and reports before and after sizes", async () => {
    const user = userEvent.setup();
    wrap(<Playground projectId={DEMO_PROJECT_ID} buckets={["acme-assets"]} bucket="acme-assets" images={images} />);

    const url = screen.getByTestId("transform-url");
    expect(url).toHaveTextContent("w=640");
    expect(url).toHaveTextContent("format=webp");
    expect(screen.getByTestId("size-before")).toBeInTheDocument();
    expect(await screen.findByTestId("size-after", {}, { timeout: 5000 })).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Format"), "avif");
    await waitFor(() => expect(screen.getByTestId("transform-url")).toHaveTextContent("format=avif"));
    expect(await screen.findByText(/% smaller/, {}, { timeout: 5000 })).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Format"), "");
    await waitFor(() => expect(screen.getByTestId("transform-url")).not.toHaveTextContent("format="));
  });
});
