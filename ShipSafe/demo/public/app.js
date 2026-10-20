const $ = (id) => document.getElementById(id);

const userId = $("user-id");
userId.value = `shopper-${Math.floor(Math.random() * 90000) + 10000}`;

let lastState = null;

const shopper = () => ({ userId: userId.value || "visitor", country: $("country").value, plan: $("plan").value });

async function post(path, body = {}) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return response.json();
}

function percent(errors, requests) {
  return requests === 0 ? "–" : `${((errors / requests) * 100).toFixed(1)}%`;
}

function render(state) {
  lastState = state;

  const connection = $("connection");
  connection.textContent = state.connected ? "Connected to ShipSafe" : "Waiting for ShipSafe…";
  connection.classList.toggle("ok", state.connected);

  const variant = state.you.enabled ? "new" : "classic";
  const checkout = $("checkout");
  if (checkout.dataset.variant !== variant) {
    checkout.dataset.variant = variant;
    $("checkout-badge").hidden = variant !== "new";
    $("checkout-title").textContent = variant === "new" ? "One-step checkout" : "Checkout";
    $("checkout-copy").textContent =
      variant === "new" ? "Pay in a single tap with your saved details." : "Step 1 of 3: address, payment, review.";
    $("place-order").textContent = variant === "new" ? "Pay $84.00 now" : "Continue";
  }

  const flag = state.flag;
  $("flag-status").textContent = flag
    ? `new-checkout is ${flag.enabled ? `ON for ${flag.rolloutPercent}% of shoppers` : "OFF for everyone"}`
    : "new-checkout is not available";

  const banner = $("rollback-banner");
  if (state.rollback) {
    const when = new Date(state.rollback.at).toLocaleTimeString();
    banner.innerHTML = "";
    const title = document.createElement("strong");
    title.textContent = `ShipSafe switched new-checkout off at ${when}`;
    const detail = document.createElement("span");
    detail.textContent = state.rollback.summary;
    banner.append(title, detail);
    banner.hidden = false;
  } else {
    banner.hidden = true;
  }

  const { on, off } = state.window;
  $("window").textContent = state.windowSeconds;
  $("rate-on").textContent = percent(on.errors, on.requests);
  $("rate-off").textContent = percent(off.errors, off.requests);
  $("count-on").textContent = `${on.requests} requests, ${on.errors} errors`;
  $("count-off").textContent = `${off.requests} requests, ${off.errors} errors`;
  document.querySelector(".result-card.new").classList.toggle("bad", on.requests > 20 && on.errors / on.requests > 0.1);

  const traffic = $("traffic-toggle");
  traffic.textContent = state.trafficRps > 0 ? `Stop traffic (${state.trafficRps}/s)` : "Start traffic";
  traffic.classList.toggle("on", state.trafficRps > 0);

  const bug = $("bug-toggle");
  bug.textContent = state.bugShipped ? "Bad build is live" : "Ship a bad build";
  bug.classList.toggle("active", state.bugShipped);
}

async function refresh() {
  try {
    const params = new URLSearchParams(shopper());
    const response = await fetch(`/api/state?${params}`);
    render(await response.json());
  } catch {
    $("connection").textContent = "Demo server unreachable";
    $("connection").classList.remove("ok");
  }
}

$("place-order").addEventListener("click", async () => {
  const result = $("order-result");
  const outcome = await post("/api/checkout", shopper());
  result.textContent = outcome.ok
    ? `Order placed with the ${outcome.variant} checkout.`
    : `Something went wrong with the ${outcome.variant} checkout. Please try again.`;
  result.className = `result ${outcome.ok ? "ok" : "fail"}`;
  refresh();
});

$("traffic-toggle").addEventListener("click", async () => {
  await post("/api/traffic", { rps: lastState && lastState.trafficRps > 0 ? 0 : 30 });
  refresh();
});

$("bug-toggle").addEventListener("click", async () => {
  await post("/api/bug", { on: !(lastState && lastState.bugShipped) });
  refresh();
});

$("rerelease").addEventListener("click", async () => {
  await post("/api/rerelease");
  refresh();
});

for (const id of ["user-id", "country", "plan"]) {
  $(id).addEventListener("input", refresh);
}

refresh();
setInterval(refresh, 400);
