import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  parseDraft,
  serializeDraft,
  readDraft,
  writeDraft,
  transitionDraft,
  ALLOWED_TRANSITIONS,
} from "../src/tools/drafts-fs.js";

const RAW_DRAFT = `---
id: test-001
platform: x
status: draft
author: alice
created: 2026-04-15
topic: Testing
post_text: "Hello: world"
source_urls:
  - https://example.com
  - https://foo.bar
metrics:
  impressions: 42
  engagement: 7
  measured_at: 2026-04-16
---

This is the body text.
`;

describe("parseDraft", () => {
  it("parses all field types correctly", () => {
    const d = parseDraft(RAW_DRAFT);
    expect(d.frontmatter.id).toBe("test-001");
    expect(d.frontmatter.platform).toBe("x");
    expect(d.frontmatter.status).toBe("draft");
    expect(d.frontmatter.author).toBe("alice");
    expect(d.frontmatter.created).toBe("2026-04-15");
    expect(d.frontmatter.topic).toBe("Testing");
    expect(d.frontmatter.post_text).toBe("Hello: world");
    expect(d.frontmatter.source_urls).toEqual(["https://example.com", "https://foo.bar"]);
    expect(d.frontmatter.metrics).toEqual({
      impressions: 42,
      engagement: 7,
      measured_at: "2026-04-16",
    });
    expect(d.body).toBe("This is the body text.\n");
  });

  it("throws if no frontmatter delimiter at start", () => {
    expect(() => parseDraft("no frontmatter here")).toThrow();
    expect(() => parseDraft("# Just a heading\n\nsome text")).toThrow();
  });
});

describe("serializeDraft + parseDraft roundtrip", () => {
  it("roundtrips without data loss", () => {
    const d1 = parseDraft(RAW_DRAFT);
    const serialized = serializeDraft(d1);
    const d2 = parseDraft(serialized);
    expect(d2.frontmatter).toEqual(d1.frontmatter);
    expect(d2.body).toEqual(d1.body);
  });
});

describe("writeDraft + readDraft roundtrip", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "drafts-test-"));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("writes and reads back a draft correctly", () => {
    const d = parseDraft(RAW_DRAFT);
    writeDraft(root, d);
    const d2 = readDraft(root, "test-001");
    expect(d2.frontmatter).toEqual(d.frontmatter);
    expect(d2.body).toEqual(d.body);
  });

  it("creates the drafts directory if it does not exist", () => {
    const d = parseDraft(RAW_DRAFT);
    writeDraft(root, d);
    expect(fs.existsSync(path.join(root, "drafts", "test-001.md"))).toBe(true);
  });
});

describe("transitionDraft", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "drafts-transition-"));
    const d = parseDraft(RAW_DRAFT);
    writeDraft(root, d);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("allows draft → ready-for-review", () => {
    const d = transitionDraft(root, "test-001", "ready-for-review");
    expect(d.frontmatter.status).toBe("ready-for-review");
  });

  it("persists the transition on disk", () => {
    transitionDraft(root, "test-001", "ready-for-review");
    const d = readDraft(root, "test-001");
    expect(d.frontmatter.status).toBe("ready-for-review");
  });

  it("applies patch fields during transition", () => {
    const d = transitionDraft(root, "test-001", "ready-for-review", { topic: "Updated Topic" });
    expect(d.frontmatter.topic).toBe("Updated Topic");
  });

  it("throws on disallowed transition: ready-for-review → measured", () => {
    transitionDraft(root, "test-001", "ready-for-review");
    expect(() => transitionDraft(root, "test-001", "measured")).toThrow();
  });
});

describe("ALLOWED_TRANSITIONS", () => {
  it("forbids published → draft", () => {
    expect(ALLOWED_TRANSITIONS["published"]).not.toContain("draft");
  });

  it("allows draft → rejected", () => {
    expect(ALLOWED_TRANSITIONS["draft"]).toContain("rejected");
  });

  it("measured has no outgoing transitions", () => {
    expect(ALLOWED_TRANSITIONS["measured"]).toEqual([]);
  });
});
