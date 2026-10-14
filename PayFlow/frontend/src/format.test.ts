import { clock, compactMoney, failureLabel, money, percent, shortId, timeAgo } from "./format";

describe("money", () => {
  it("formats integer cents as dollars", () => {
    expect(money(123456)).toBe("$1,234.56");
    expect(money(5)).toBe("$0.05");
    expect(money(0)).toBe("$0.00");
  });
  it("keeps the sign of debits and can force a plus on credits", () => {
    expect(money(-2500)).toBe("-$25.00");
    expect(money(2500, true)).toBe("+$25.00");
    expect(money(0, true)).toBe("$0.00");
  });
  it("abbreviates large amounts", () => {
    expect(compactMoney(250_000)).toBe("$2,500.00");
    expect(compactMoney(5_000_000)).toBe("$50.0K");
    expect(compactMoney(250_000_000)).toBe("$2.50M");
  });
});

describe("helpers", () => {
  it("formats percentages and handles missing data", () => {
    expect(percent(0.1234)).toBe("12.3%");
    expect(percent(0.0071, 2)).toBe("0.71%");
    expect(percent(null)).toBe("n/a");
    expect(percent(undefined)).toBe("n/a");
  });
  it("shortens ids", () => expect(shortId("abcdef12-3456")).toBe("abcdef12"));
  it("describes elapsed time", () => {
    const now = Date.parse("2026-01-01T12:00:00Z");
    expect(timeAgo("2026-01-01T11:59:58Z", now)).toBe("just now");
    expect(timeAgo("2026-01-01T11:59:30Z", now)).toBe("30s ago");
    expect(timeAgo("2026-01-01T11:55:00Z", now)).toBe("5m ago");
    expect(timeAgo("2026-01-01T09:00:00Z", now)).toBe("3h ago");
    expect(timeAgo("2025-12-30T12:00:00Z", now)).toBe("2d ago");
  });
  it("labels failure reasons", () => {
    expect(failureLabel("insufficient_funds")).toBe("Insufficient funds");
    expect(failureLabel("something_new")).toBe("something new");
  });
  it("renders a clock time", () => expect(clock("2026-01-01T12:34:56Z")).toMatch(/\d{2}:\d{2}:\d{2}/));
});
