const project = "6f0c1f0e-5b1a-4a0e-9a53-0d6f3f6a1001";
const port = process.env.LHCI_PORT ?? "3200";
const base = `http://127.0.0.1:${port}`;

// Audits run against the demo build: it needs no backend, so scores reflect the front end alone.
module.exports = {
  ci: {
    collect: {
      startServerCommand: `pnpm exec cross-env NEXT_PUBLIC_DEMO=1 NEXT_DIST_DIR=.next-demo next start -p ${port}`,
      startServerReadyPattern: "Ready",
      startServerReadyTimeout: 60000,
      url: [
        `${base}/login`,
        `${base}/projects`,
        `${base}/p/${project}/files?bucket=acme-assets`,
        `${base}/p/${project}/analytics`,
        `${base}/p/${project}/webhooks`,
      ],
      numberOfRuns: Number(process.env.LHCI_RUNS ?? 3),
      settings: {
        chromeFlags: "--headless=new --no-sandbox --disable-gpu",
        preset: process.env.LHCI_PRESET ?? "desktop",
        onlyCategories: ["performance", "accessibility", "best-practices", "seo"],
      },
    },
    assert: {
      assertMatrix: [
        {
          // Every page: accessibility must be perfect and performance at least 95.
          matchingUrlPattern: "^http://[^/]+/(login|projects|p/[^/]+/(files|webhooks))",
          assertions: {
            "categories:performance": ["error", { minScore: 0.95, aggregationMethod: "median-run" }],
            "categories:accessibility": ["error", { minScore: 1, aggregationMethod: "median-run" }],
            "categories:best-practices": ["warn", { minScore: 0.95, aggregationMethod: "median-run" }],
            "categories:seo": ["warn", { minScore: 0.9, aggregationMethod: "median-run" }],
          },
        },
        {
          // The analytics page ships a charting library (about 200 KB gzip, roughly 250 ms of script work on a desktop
          // CPU), so its performance floor is lower. Accessibility still has to be 100.
          matchingUrlPattern: "^http://[^/]+/p/[^/]+/analytics",
          assertions: {
            "categories:performance": ["error", { minScore: 0.85, aggregationMethod: "median-run" }],
            "categories:accessibility": ["error", { minScore: 1, aggregationMethod: "median-run" }],
            "categories:best-practices": ["warn", { minScore: 0.95, aggregationMethod: "median-run" }],
          },
        },
      ],
    },
    upload: { target: "filesystem", outputDir: ".lighthouseci" },
  },
};
