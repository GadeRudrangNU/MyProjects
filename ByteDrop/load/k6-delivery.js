// k6 load test for the delivery path.
//
//   k6 run load/k6-delivery.js -e BASE_URL=http://localhost:4000 -e BUCKET=acme-assets -e KEY=hero/shot-01.png
import http from "k6/http";
import { check, group, sleep } from "k6";
import { Counter, Trend } from "k6/metrics";

const BASE = __ENV.BASE_URL || "http://localhost:4000";
const BUCKET = __ENV.BUCKET || "acme-assets";
const KEY = __ENV.KEY || "hero/shot-01.png";
const FILE = `${BASE}/f/${BUCKET}/${KEY}`;

const notModified = new Counter("delivery_304");
const partial = new Counter("delivery_206");
const transformMs = new Trend("transform_cached_ms", true);

export const options = {
  scenarios: {
    browsers: {
      // People opening pages: a full download, then revalidating on later visits.
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "20s", target: 40 },
        { duration: "40s", target: 40 },
        { duration: "10s", target: 0 },
      ],
      exec: "browse",
    },
    video: {
      // Players seeking through a file with range requests.
      executor: "constant-vus",
      vus: 10,
      duration: "70s",
      exec: "seek",
    },
    images: {
      // Responsive images asking for a handful of widths. After the first request each variant comes from cache.
      executor: "constant-arrival-rate",
      rate: 60,
      timeUnit: "1s",
      duration: "70s",
      preAllocatedVUs: 20,
      exec: "images",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    "http_req_duration{kind:revalidate}": ["p(95)<150"],
    "http_req_duration{kind:download}": ["p(95)<500"],
    "http_req_duration{kind:range}": ["p(95)<300"],
    transform_cached_ms: ["p(95)<300"],
  },
};

export function browse() {
  group("first visit", () => {
    const res = http.get(FILE, { tags: { kind: "download" } });
    check(res, {
      "200": (r) => r.status === 200,
      "has ETag": (r) => !!r.headers["Etag"],
      "has Cache-Control": (r) => !!r.headers["Cache-Control"],
    });
    const etag = res.headers["Etag"];
    sleep(0.5);
    group("return visit", () => {
      const again = http.get(FILE, { headers: { "If-None-Match": etag }, tags: { kind: "revalidate" } });
      check(again, { "304": (r) => r.status === 304 });
      if (again.status === 304) notModified.add(1);
    });
  });
  sleep(1);
}

export function seek() {
  const start = Math.floor(Math.random() * 50_000);
  const res = http.get(FILE, { headers: { Range: `bytes=${start}-${start + 16_383}` }, tags: { kind: "range" } });
  check(res, { "206 or 200": (r) => r.status === 206 || r.status === 200 });
  if (res.status === 206) partial.add(1);
  sleep(0.2);
}

const WIDTHS = [160, 320, 480, 640, 800];
export function images() {
  const w = WIDTHS[Math.floor(Math.random() * WIDTHS.length)];
  const res = http.get(`${FILE}?w=${w}&format=webp`, { tags: { kind: "transform" } });
  check(res, { "200": (r) => r.status === 200, "webp": (r) => (r.headers["Content-Type"] || "").includes("image/webp") });
  transformMs.add(res.timings.duration);
}
