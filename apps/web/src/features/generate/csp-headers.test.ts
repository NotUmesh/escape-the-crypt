import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { headersWithWorkerOrigin } from "./csp-headers";
import { parseWorkerOrigin } from "./worker-config";

const REAL = readFileSync(resolve(process.cwd(), "public/_headers"), "utf8");
const ORIGIN = "https:\u002f\u002fworker.example.com";

describe("parseWorkerOrigin", () => {
  const accepted: [string, string][] = [
    ["https:\u002f\u002fworker.example.com", "https:\u002f\u002fworker.example.com"],
    ["https:\u002f\u002fWorker.Example.COM/", "https:\u002f\u002fworker.example.com"],
    ["https:\u002f\u002fworker.example.com:8443", "https:\u002f\u002fworker.example.com:8443"],
    ["https:\u002f\u002fworker.example.com:443", "https:\u002f\u002fworker.example.com"],
    ["http:\u002f\u002flocalhost:8787", "http:\u002f\u002flocalhost:8787"],
    ["http:\u002f\u002f127.0.0.1:8787/", "http:\u002f\u002f127.0.0.1:8787"],
    ["https:\u002f\u002flocalhost", "https:\u002f\u002flocalhost"],
  ];
  it.each(accepted)("accepts %s", (raw, expected) => {
    expect(parseWorkerOrigin(raw)).toBe(expected);
  });

  const rejected = [
    undefined, "", "worker.example.com", "ftp:\u002f\u002fworker.example.com", "http:\u002f\u002fworker.example.com",
    "http:\u002f\u002fevil.localhost.com", "https:\u002f\u002fworker.example.com/path", "https:\u002f\u002fworker.example.com//",
    "https:\u002f\u002fworker.example.com?x=1", "https:\u002f\u002fworker.example.com/?", "https:\u002f\u002fworker.example.com#frag",
    "https:\u002f\u002fworker.example.com/#", "https:\u002f\u002fuser@worker.example.com", "https:\u002f\u002fuser:pw@worker.example.com",
    "https:\u002f\u002f*.example.com", "*", "https:\u002f\u002fworker.example.com *", " https:\u002f\u002fworker.example.com",
    "https:\u002f\u002fworker.example.com\n", "https:\u002f\u002fworker.example.com;", "https:\u002f\u002fworker.example.com; script-src *",
    "'https:\u002f\u002fworker.example.com'", "\"https:\u002f\u002fworker.example.com\"", "https:\u002f\u002f", "https:\u002f\u002f/", "not a url",
  ];
  it.each(rejected)("rejects %j", (raw) => {
    expect(parseWorkerOrigin(raw)).toBeNull();
  });
});

describe("headersWithWorkerOrigin", () => {
  it("adds exactly the configured origin to connect-src, once", () => {
    const out = headersWithWorkerOrigin(REAL, ORIGIN);
    expect(out).toContain(`connect-src 'self' ${ORIGIN};`);
    expect(out.split(ORIGIN)).toHaveLength(2);
    expect(out).not.toContain("*  ");
    expect(out.match(/https?:\/\/[^\s;]+/g)).toEqual([ORIGIN]);
  });

  it("changes nothing when the origin is unset", () => {
    expect(headersWithWorkerOrigin(REAL, null)).toBe(REAL);
    expect(REAL).toContain("connect-src 'self';");
  });

  it("does not duplicate an origin already present", () => {
    const once = headersWithWorkerOrigin(REAL, ORIGIN);
    expect(headersWithWorkerOrigin(once, ORIGIN)).toBe(once);
  });

  it("leaves every other directive and line byte for byte unchanged", () => {
    const out = headersWithWorkerOrigin(REAL, ORIGIN);
    expect(out.replace(` ${ORIGIN}`, "")).toBe(REAL);
  });

  it("keeps line endings and other lines with CRLF input", () => {
    const crlf = REAL.replace(/\n/g, "\r\n");
    const out = headersWithWorkerOrigin(crlf, ORIGIN);
    expect(out.replace(` ${ORIGIN}`, "")).toBe(crlf);
  });

  it("does not touch connect-src text outside a Content-Security-Policy line", () => {
    const text = "/*\n  X-Note: connect-src 'self'\n";
    expect(headersWithWorkerOrigin(text, ORIGIN)).toBe(text);
  });

  it.each(["https:\u002f\u002fworker.example.com/path", "*", "https:\u002f\u002fa.com; script-src *", "HTTPS:\u002f\u002fWorker.example.com", "http:\u002f\u002fexample.com"])(
    "refuses to write %j",
    (origin) => {
      expect(() => headersWithWorkerOrigin(REAL, origin)).toThrow();
    },
  );
});



