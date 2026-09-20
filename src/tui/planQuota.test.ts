// Unit coverage for the plan-quota surface — parsers and formatters only
// (the network half is fail-soft by design and covered by the ST pty
// stage). Fixtures are the live payloads measured 2026-09-20.
import { describe, expect, test } from "bun:test";
import {
  formatCompact,
  formatReset,
  parseQuotaLimit,
  parseQuotaPayload,
  parseSubscriptionPayload,
  parseUsageStats,
  quotaBar,
  readStoredApiKey,
} from "./planQuota";

const LIVE_QUOTA = {
  code: 200,
  msg: "Operation successful",
  success: true,
  data: {
    limits: [
      { type: "CREDIT_LIMIT", unit: 3, number: 5, usage: 12000, currentValue: 1063, remaining: 10936, percentage: 8, nextResetTime: 1789873736719 },
      { type: "CREDIT_LIMIT", unit: 6, number: 1, usage: 60000, currentValue: 47172, remaining: 12827, percentage: 78, nextResetTime: 1790084155962 },
    ],
    level: "pro",
  },
};

describe("parseQuotaPayload", () => {
  test("parses the live quota payload into the two windows", () => {
    const snap = parseQuotaPayload(LIVE_QUOTA);
    expect(snap).not.toBeNull();
    expect(snap!.level).toBe("pro");
    expect(snap!.limits.length).toBe(2);
    expect(snap!.limits[0]!.label).toBe("5-hour");
    expect(snap!.limits[0]!.used).toBe(1063);
    expect(snap!.limits[0]!.total).toBe(12000);
    expect(snap!.limits[1]!.label).toBe("Weekly");
    expect(snap!.limits[1]!.percentage).toBe(78);
  });

  test("rejects envelopes without data", () => {
    expect(parseQuotaPayload({ code: 500, msg: "x" })).toBeNull();
    expect(parseQuotaPayload(null)).toBeNull();
  });
});

describe("parseQuotaLimit", () => {
  test("falls back to computed remaining/percentage and a generic label", () => {
    const l = parseQuotaLimit({ unit: 9, number: 2, usage: 100, currentValue: 25 });
    expect(l).not.toBeNull();
    expect(l!.label).toBe("Plan window");
    expect(l!.remaining).toBe(75);
    expect(l!.percentage).toBe(25);
  });

  test("rejects rows with no usable denominator", () => {
    expect(parseQuotaLimit({ usage: 0, currentValue: 0 })).toBeNull();
    expect(parseQuotaLimit("junk")).toBeNull();
  });
});

describe("parseSubscriptionPayload", () => {
  test("picks the VALID subscription and its renew date", () => {
    const sub = parseSubscriptionPayload({
      data: [
        { productName: "GLM Coding Pro", status: "VALID", valid: "2026-11-27 18:02:56-2027-02-27 18:02:56", nextRenewTime: "2026-11-27" },
        { productName: "Old", status: "EXPIRED" },
      ],
    });
    expect(sub.name).toBe("GLM Coding Pro");
    expect(sub.renews).toBe("2026-11-27");
  });

  test("falls back to the valid window end when nextRenewTime is missing", () => {
    const sub = parseSubscriptionPayload({
      data: [{ productName: "GLM Coding Pro", status: "VALID", valid: "2026-11-27 18:02:56-2027-02-27 18:02:56" }],
    });
    expect(sub.renews).toBe("2027-02-27");
  });

  test("answers all-null on junk", () => {
    expect(parseSubscriptionPayload({ data: "junk" })).toEqual({ name: null, status: null, renews: null });
  });
});

describe("parseUsageStats", () => {
  test("reads the summary half of usage/stats", () => {
    const s = parseUsageStats({ summary: { totalTokens: 31966197, totalSessions: 181, totalTurns: 192, activeDays: 4 } });
    expect(s).not.toBeNull();
    expect(s!.totalTokens).toBe(31966197);
    expect(s!.activeDays).toBe(4);
  });

  test("null on junk", () => {
    expect(parseUsageStats({})).toBeNull();
  });
});

describe("formatters", () => {
  test("formatCompact", () => {
    expect(formatCompact(31966197)).toBe("32.0M");
    expect(formatCompact(47172)).toBe("47.2k");
    expect(formatCompact(1063)).toBe("1063");
  });

  test("formatReset horizons", () => {
    const now = 1_000_000_000_000;
    expect(formatReset(now - 5, now)).toBe("now");
    expect(formatReset(now + 38 * 60_000, now)).toBe("in 38m");
    expect(formatReset(now + (2 * 60 + 14) * 60_000, now)).toBe("in 2h 14m");
    expect(formatReset(now + 96 * 60 * 60_000, now)).toMatch(/^[A-Z][a-z]{2} \d{1,2}$/);
    expect(formatReset(null, now)).toBe("");
  });

  test("quotaBar clamps", () => {
    expect(quotaBar(0)).toBe("░░░░░░░░░░");
    expect(quotaBar(78)).toBe("████████░░");
    expect(quotaBar(100)).toBe("██████████");
    expect(quotaBar(140)).toBe("██████████");
    expect(quotaBar(-3)).toBe("░░░░░░░░░░");
  });
});

describe("readStoredApiKey", () => {
  test("null when no stored auth (never throws)", () => {
    expect(readStoredApiKey("/nonexistent-home-for-test")).toBeNull();
  });
});
