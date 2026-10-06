import "@testing-library/jest-dom";

(globalThis as unknown as { __API_URL__: string }).__API_URL__ = "";
// recharts' ResponsiveContainer needs ResizeObserver, which jsdom lacks
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
