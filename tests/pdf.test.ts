import { describe, it, expect, beforeAll } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { extractPdfText } from "../src/tools/pdf.js";

let helloPdf: Buffer;

beforeAll(async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 200]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("Hello World from Phase 3", {
    x: 50,
    y: 100,
    size: 18,
    font,
  });
  helloPdf = Buffer.from(await doc.save());
});

describe("extractPdfText", () => {
  it("extracts text from a simple PDF", async () => {
    const text = await extractPdfText(helloPdf);
    expect(text).toMatch(/Hello World from Phase 3/);
  });

  it("truncates output at 50k characters", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const filler = "filler ".repeat(10_000);
    const page = doc.addPage([600, 800]);
    page.drawText(filler.slice(0, 6000), { x: 20, y: 20, size: 6, font });
    const bigPdf = Buffer.from(await doc.save());
    const text = await extractPdfText(bigPdf);
    expect(text.length).toBeLessThanOrEqual(50_000 + "\n... (truncated)".length);
  });
});
