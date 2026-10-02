import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";
import type { Invoice } from "./domain.js";

const font = fileURLToPath(
  new URL("../../assets/fonts/NotoSans-Regular.ttf", import.meta.url),
);
const currency = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    cents / 100,
  );
const statuses = {
  draft: "BORRADOR",
  issued: "EMITIDA",
  paid: "PAGADA",
  void: "ANULADA",
};

export function invoicePdf(invoice: Invoice): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 48,
      bufferPages: true,
      info: {
        Title: `InvoiceOps - ${invoice.reference}`,
        Author: "InvoiceOps",
        Subject: "Resumen operativo de factura",
      },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.font(font);
    const right = 547;
    const width = right - 48;
    const heading = (continuation = false) => {
      doc.fillColor("#14243e").fontSize(24).text("InvoiceOps", 48, 45);
      doc
        .fillColor("#687a96")
        .fontSize(9)
        .text(
          continuation ? "FACTURA / CONTINUACION" : "RESUMEN DE FACTURA",
          48,
          83,
        );
      doc
        .fillColor("#3067ec")
        .fontSize(11)
        .text(statuses[invoice.status], 370, 55, {
          width: 177,
          align: "right",
        });
      doc.strokeColor("#dce4ee").moveTo(48, 111).lineTo(right, 111).stroke();
    };
    const tableHeader = (y: number) => {
      doc.rect(48, y, width, 26).fill("#f0f3f8");
      doc.fillColor("#647793").fontSize(8);
      doc.text("CONCEPTO", 58, y + 8, { width: 242 });
      doc.text("CANT.", 305, y + 8, { width: 42, align: "right" });
      doc.text("PRECIO USD", 355, y + 8, { width: 80, align: "right" });
      doc.text("IMPORTE USD", 440, y + 8, { width: 96, align: "right" });
    };
    heading();
    doc.fillColor("#7c8aa0").fontSize(9).text("CLIENTE", 48, 135);
    doc
      .fillColor("#1b2b43")
      .fontSize(13)
      .text(invoice.customer, 48, 153, { width });
    let y = Math.max(193, doc.y + 15);
    doc
      .fontSize(10)
      .fillColor("#536581")
      .text(`Referencia: ${invoice.reference}`, 48, y, { width });
    y = doc.y + 10;
    doc.text(
      `Fecha: ${new Intl.DateTimeFormat("es-EC", { timeZone: "America/Guayaquil", dateStyle: "long" }).format(new Date(invoice.createdAt))}  |  Version: ${invoice.version}`,
      48,
      y,
      { width },
    );
    y = doc.y + 9;
    doc.fontSize(8).text(`ID: ${invoice.id}`, 48, y, { width });
    y = doc.y + 22;
    tableHeader(y);
    y += 34;
    for (const line of invoice.lines) {
      doc.fontSize(9);
      const height = Math.max(
        31,
        doc.heightOfString(line.description, { width: 240 }) + 15,
      );
      if (y + height > 720) {
        doc.addPage();
        heading(true);
        y = 140;
        tableHeader(y);
        y += 34;
      }
      doc.fillColor("#283b56").text(line.description, 58, y, { width: 240 });
      doc.text(String(line.quantity), 305, y, { width: 42, align: "right" });
      doc.text(currency(line.unitPriceCents), 355, y, {
        width: 80,
        align: "right",
      });
      doc.text(currency(line.unitPriceCents * line.quantity), 440, y, {
        width: 96,
        align: "right",
      });
      doc
        .strokeColor("#edf1f7")
        .moveTo(48, y + height - 8)
        .lineTo(right, y + height - 8)
        .stroke();
      y += height;
    }
    if (y + 150 > 730) {
      doc.addPage();
      heading(true);
      y = 150;
    }
    y += 18;
    doc
      .fillColor("#677a95")
      .fontSize(10)
      .text("Subtotal", 345, y, { width: 100 });
    doc.fillColor("#263b58").text(currency(invoice.subtotalCents), 440, y, {
      width: 96,
      align: "right",
    });
    y += 26;
    doc
      .fillColor("#677a95")
      .text(`Impuesto (${invoice.taxBasisPoints / 100} %)`, 345, y, {
        width: 100,
      });
    doc
      .fillColor("#263b58")
      .text(currency(invoice.taxCents), 440, y, { width: 96, align: "right" });
    y += 30;
    doc.rect(335, y - 7, 212, 39).fill("#eaf0fd");
    doc
      .fillColor("#1c4ea9")
      .fontSize(12)
      .text("TOTAL USD", 345, y + 3, { width: 90 });
    doc.fontSize(11).text(currency(invoice.totalCents), 430, y + 3, {
      width: 107,
      align: "right",
    });
    const pages = doc.bufferedPageRange();
    for (let index = 0; index < pages.count; index++) {
      doc.switchToPage(index);
      doc.strokeColor("#e0e6ef").moveTo(48, 769).lineTo(right, 769).stroke();
      doc
        .fillColor("#8392a8")
        .fontSize(7)
        .text(
          "Documento operativo. No sustituye un comprobante fiscal.",
          48,
          781,
          { width: 385, lineBreak: false },
        );
      doc.text(`${index + 1} / ${pages.count}`, 457, 781, {
        width: 90,
        align: "right",
        lineBreak: false,
      });
    }
    doc.end();
  });
}
