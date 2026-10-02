import assert from "node:assert/strict";
import test from "node:test";
import { type InvoiceInput, totals } from "../src/domain.js";
import { invoicePdf } from "../src/pdf.js";

test("PDF handles accented customer names and all 100 lines across multiple pages", async () => {
  const input: InvoiceInput = {
    customer: "Compañía de Ingeniería",
    reference: "PO-PDF-100",
    taxBasisPoints: 1500,
    lines: Array.from({ length: 100 }, (_, index) => ({
      description: `Servicio ${index + 1}: diseño de integración y operación de plataforma con revisión de parámetros de seguridad y disponibilidad.`,
      quantity: 2,
      unitPriceCents: 9999,
    })),
  };
  const data = await invoicePdf({
    ...input,
    ...totals(input),
    id: "66f1d9b5-c0fa-47d9-a986-32023468ca03",
    status: "issued",
    version: 2,
    createdAt: "2026-10-02T10:00:00.000Z",
  });
  assert.equal(data.subarray(0, 5).toString("ascii"), "%PDF-");
  assert.match(data.subarray(-20).toString("ascii"), /%%EOF/);
  const pages = data.toString("latin1").match(/\/Type \/Page\b/g)?.length ?? 0;
  assert.ok(
    pages >= 5 && pages <= 15,
    `Expected readable pagination, got ${pages} pages`,
  );
});
