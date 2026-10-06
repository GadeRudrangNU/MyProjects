module.exports = {
  testEnvironment: "jsdom",
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { tsconfig: { jsx: "react-jsx", esModuleInterop: true, module: "commonjs", moduleResolution: "node", types: ["jest", "@testing-library/jest-dom"] }, diagnostics: false }],
  },
  moduleNameMapper: { "\\.css$": "identity-obj-proxy" },
  setupFilesAfterEnv: ["<rootDir>/src/setupTests.ts"],
  collectCoverageFrom: ["src/**/*.{ts,tsx}", "!src/main.tsx", "!src/fixtures.ts", "!src/__tests__/**", "!src/setupTests.ts", "!src/vite-env.d.ts"],
  coverageThreshold: { global: { lines: 85, statements: 85, functions: 80, branches: 70 } },
};
