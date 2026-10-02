import assert from "node:assert/strict";
import test from "node:test";
import {
  authorize,
  DomainError,
  decodeCursor,
  invoiceInput,
  pageQuery,
  totals,
  transition,
} from "../src/domain.js";

test("issuer and collector permissions are independent and admin can operate both", () => {
  for (const command of ["create", "issue", "void"] as const) {
    authorize("issuer", command);
    authorize("admin", command);
    assert.throws(
      () => authorize("collector", command),
      (error: unknown) => error instanceof DomainError && error.status === 403,
    );
  }
  authorize("collector", "pay");
  authorize("admin", "pay");
  assert.throws(() => authorize("issuer", "pay"), DomainError);
});

test("pagination inputs reject malformed cursors and excessive page sizes", () => {
  assert.equal(pageQuery.parse({}).limit, 20);
  assert.equal(pageQuery.safeParse({ limit: 101 }).success, false);
  assert.throws(() => decodeCursor("not-valid-json"), DomainError);
  const value = {
    createdAt: "2026-10-02T10:11:12.123456Z",
    id: "66f1d9b5-c0fa-47d9-a986-32023468ca03",
  };
  assert.deepEqual(
    decodeCursor(Buffer.from(JSON.stringify(value)).toString("base64url")),
    value,
  );
});

test("money uses integer cents and half-up rounding on the invoice subtotal", () => {
  const input = invoiceInput.parse({
    customer: "Acme",
    reference: "PO-1",
    lines: [
      { description: "Support", quantity: 2, unitPriceCents: 12000 },
      { description: "Hosting", quantity: 1, unitPriceCents: 1999 },
    ],
    taxBasisPoints: 1500,
  });
  assert.deepEqual(totals(input), {
    subtotalCents: 25999,
    taxCents: 3900,
    totalCents: 29899,
  });
  assert.equal(
    totals({
      ...input,
      lines: [{ description: "Small", quantity: 1, unitPriceCents: 1 }],
      taxBasisPoints: 2500,
    }).taxCents,
    0,
  );
  assert.equal(
    totals({
      ...input,
      lines: [{ description: "Small", quantity: 2, unitPriceCents: 1 }],
      taxBasisPoints: 2500,
    }).taxCents,
    1,
  );
});

test("rejects amounts beyond the business limit and malformed inputs", () => {
  const line = {
    description: "Large",
    quantity: 10000,
    unitPriceCents: 100000000,
  };
  assert.throws(
    () =>
      totals({
        customer: "Acme",
        reference: "PO-1",
        lines: [line],
        taxBasisPoints: 1500,
      }),
    DomainError,
  );
  assert.equal(
    invoiceInput.safeParse({
      customer: "Acme",
      reference: "PO-1",
      lines: [{ ...line, quantity: 1.2 }],
      taxBasisPoints: 0,
    }).success,
    false,
  );
  assert.equal(
    invoiceInput.safeParse({
      customer: "Acme",
      reference: "PO-1",
      lines: [],
      taxBasisPoints: 0,
    }).success,
    false,
  );
  assert.equal(
    invoiceInput.safeParse({
      customer: "Acme",
      reference: "PO-1",
      lines: [line],
      taxBasisPoints: 0,
      status: "paid",
    }).success,
    false,
  );
});

test("invoice lifecycle prevents premature payments and changes to terminal states", () => {
  assert.equal(transition("draft", "issue"), "issued");
  assert.equal(transition("issued", "pay"), "paid");
  assert.equal(transition("draft", "void"), "void");
  assert.equal(transition("issued", "void"), "void");
  for (const status of ["paid", "void"] as const)
    for (const command of ["issue", "pay", "void"] as const) {
      assert.throws(() => transition(status, command), DomainError);
    }
  assert.throws(() => transition("draft", "pay"), DomainError);
});
