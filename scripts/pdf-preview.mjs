import { mkdirSync, writeFileSync } from "node:fs";
import { totals } from "../dist/src/domain.js";
import { invoicePdf } from "../dist/src/pdf.js";

const input = {
  customer: "Compañía Andina de Tecnología",
  reference: "PO-2026-041",
  taxBasisPoints: 1500,
  lines: [
    {
      description: "Ingeniería de plataforma y automatización de entregas",
      quantity: 2,
      unitPriceCents: 12000,
    },
    {
      description: "Observabilidad y revisión operativa",
      quantity: 1,
      unitPriceCents: 9500,
    },
  ],
};
const fixture = {
  ...input,
  ...totals(input),
  id: "66f1d9b5-c0fa-47d9-a986-32023468ca03",
  status: "issued",
  version: 2,
  createdAt: "2026-10-02T10:00:00.000Z",
};
mkdirSync("output/pdf", { recursive: true });
writeFileSync("output/pdf/invoiceops-sample.pdf", await invoicePdf(fixture));
const long = {
  ...input,
  lines: Array.from({ length: 100 }, (_, index) => ({
    description: `Servicio ${index + 1}: diseño de integración y operación de plataforma con revisión de parámetros de seguridad y disponibilidad.`,
    quantity: 2,
    unitPriceCents: 9999,
  })),
};
mkdirSync(".artifacts/pdf", { recursive: true });
writeFileSync(
  ".artifacts/pdf/stress.pdf",
  await invoicePdf({ ...fixture, ...long, ...totals(long) }),
);
console.log("PDF sample and 100-line pagination fixture generated.");
