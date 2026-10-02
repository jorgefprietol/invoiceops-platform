import { z } from "zod";

export class DomainError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(code);
  }
}

export const invoiceInput = z
  .object({
    customer: z.string().trim().min(2).max(120),
    reference: z.string().trim().min(1).max(80),
    lines: z
      .array(
        z
          .object({
            description: z.string().trim().min(1).max(150),
            quantity: z.number().int().min(1).max(10000),
            unitPriceCents: z.number().int().min(1).max(100000000),
          })
          .strict(),
      )
      .min(1)
      .max(100),
    taxBasisPoints: z.number().int().min(0).max(2500),
  })
  .strict();

export type InvoiceInput = z.infer<typeof invoiceInput>;
export type Status = "draft" | "issued" | "paid" | "void";
export type Command = "issue" | "pay" | "void";
export type Role = "admin" | "issuer" | "collector";

export function authorize(role: Role, operation: "create" | Command) {
  if (role === "admin") return;
  if (role === "issuer" && operation !== "pay") return;
  if (role === "collector" && operation === "pay") return;
  throw new DomainError(403, "forbidden");
}

export const pageQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z
      .string()
      .min(8)
      .max(256)
      .regex(/^[A-Za-z0-9_-]+$/)
      .optional(),
  })
  .strict();

export function decodeCursor(cursor: string) {
  try {
    return z
      .object({ createdAt: z.iso.datetime(), id: z.uuid() })
      .strict()
      .parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")));
  } catch {
    throw new DomainError(400, "invalid_cursor");
  }
}
export type Invoice = InvoiceInput & {
  id: string;
  status: Status;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  version: number;
  createdAt: string;
};

export function totals(input: InvoiceInput) {
  const subtotal = input.lines.reduce(
    (sum, line) => sum + BigInt(line.quantity) * BigInt(line.unitPriceCents),
    0n,
  );
  const tax = (subtotal * BigInt(input.taxBasisPoints) + 5000n) / 10000n;
  if (subtotal + tax > 1000000000000n) {
    throw new DomainError(422, "invoice_limit_exceeded");
  }
  return {
    subtotalCents: Number(subtotal),
    taxCents: Number(tax),
    totalCents: Number(subtotal + tax),
  };
}

export function transition(status: Status, command: Command): Status {
  if (status === "draft" && command === "issue") return "issued";
  if (status === "issued" && command === "pay") return "paid";
  if ((status === "draft" || status === "issued") && command === "void")
    return "void";
  throw new DomainError(409, "invalid_transition");
}
