let token = "";
let items = [];
let pendingCreate = null;
const byId = (id) => document.getElementById(id);
const money = (cents) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    cents / 100,
  );
const names = {
  draft: "Borrador",
  issued: "Emitida",
  paid: "Pagada",
  void: "Anulada",
};
const events = {
  created: "Borrador creado",
  issue: "Factura emitida",
  pay: "Cobro registrado",
  void: "Factura anulada",
};
function notice(message) {
  byId("notice").textContent = message;
}
function parseCents(value) {
  const match = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(value.trim());
  if (!match)
    throw new Error("Introduce un precio con un máximo de dos decimales.");
  const cents =
    Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents < 1 || cents > 100000000)
    throw new Error("El precio debe estar entre $0.01 y $1,000,000.00.");
  return cents;
}
async function api(path, body, key = crypto.randomUUID()) {
  if (!token)
    throw new Error("Conecta tu espacio de trabajo con la clave de acceso.");
  const response = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Idempotency-Key": key,
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000),
  });
  const result = await response.json();
  if (!response.ok) {
    const messages = {
      unauthorized: "La clave de acceso no es válida.",
      version_conflict: "La factura cambió. Actualiza y revisa su estado.",
      invalid_transition: "El estado actual no permite esta operación.",
      invalid_request: "Revisa los campos de la solicitud.",
      invoice_limit_exceeded: "El importe supera el límite de la factura.",
    };
    throw new Error(
      messages[result.code] ??
        `No fue posible completar la operación (${response.status}).`,
    );
  }
  return result;
}
async function refresh() {
  const result = await api("/api/v1/invoices");
  items = result.items;
  byId("count").textContent = items.length;
  byId("drafts").textContent = items.filter(
    (invoice) => invoice.status === "draft",
  ).length;
  byId("outstanding").textContent = money(
    items
      .filter((invoice) => invoice.status === "issued")
      .reduce((sum, invoice) => sum + invoice.totalCents, 0),
  );
  byId("collected").textContent = money(
    items
      .filter((invoice) => invoice.status === "paid")
      .reduce((sum, invoice) => sum + invoice.totalCents, 0),
  );
  const tbody = byId("rows");
  tbody.replaceChildren();
  if (!items.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 4;
    cell.className = "empty";
    cell.textContent =
      "Tu libro está listo. Crea la primera factura para empezar.";
    row.append(cell);
    tbody.append(row);
  }
  for (const invoice of items) {
    const row = document.createElement("tr");
    const customer = document.createElement("td");
    customer.textContent = invoice.customer;
    const ref = document.createElement("small");
    ref.textContent = invoice.reference;
    customer.append(ref);
    const status = document.createElement("td");
    const badge = document.createElement("span");
    badge.className = `status ${invoice.status}`;
    badge.textContent = names[invoice.status];
    status.append(badge);
    const total = document.createElement("td");
    total.textContent = money(invoice.totalCents);
    const actions = document.createElement("td");
    const wrap = document.createElement("div");
    wrap.className = "row-actions";
    const commands =
      invoice.status === "draft"
        ? [
            ["issue", "Emitir"],
            ["void", "Anular"],
          ]
        : invoice.status === "issued"
          ? [
              ["pay", "Cobrar"],
              ["void", "Anular"],
            ]
          : [];
    for (const [command, label] of [...commands, ["audit", "Historial"]]) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      const key = crypto.randomUUID();
      button.addEventListener("click", async () => {
        button.disabled = true;
        try {
          if (command === "audit") {
            const history = await api(`/api/v1/invoices/${invoice.id}/events`);
            byId("events").replaceChildren();
            for (const event of history.items) {
              const item = document.createElement("li");
              item.textContent = `${events[event.type]} · v${event.version} · ${new Date(event.occurredAt).toLocaleString("es-EC")}`;
              byId("events").append(item);
            }
            byId("audit").hidden = false;
            byId("audit").scrollIntoView({ behavior: "smooth" });
          } else {
            await api(
              `/api/v1/invoices/${invoice.id}/${command}`,
              { expectedVersion: invoice.version },
              key,
            );
            notice("Movimiento registrado correctamente.");
            await refresh();
          }
        } catch (error) {
          notice(error.message);
        } finally {
          button.disabled = false;
        }
      });
      wrap.append(button);
    }
    actions.append(wrap);
    row.append(customer, status, total, actions);
    tbody.append(row);
  }
}
byId("login").addEventListener("submit", async (event) => {
  event.preventDefault();
  token = byId("token").value;
  try {
    await refresh();
    byId("token").value = "";
    byId("access").hidden = true;
    notice("Espacio de trabajo conectado.");
  } catch (error) {
    token = "";
    notice(error.message);
  }
});
byId("refresh").addEventListener("click", () =>
  refresh().catch((error) => notice(error.message)),
);
byId("close-audit").addEventListener("click", () => {
  byId("audit").hidden = true;
});
byId("invoice-form").addEventListener("input", () => {
  try {
    const subtotal =
      BigInt(parseCents(byId("price").value)) * BigInt(byId("quantity").value);
    const tax = (subtotal * BigInt(byId("tax").value) + 5000n) / 10000n;
    byId("estimate").textContent = money(Number(subtotal + tax));
  } catch {
    byId("estimate").textContent = "$0.00";
  }
});
byId("invoice-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  byId("submit").disabled = true;
  try {
    const body = {
      customer: byId("customer").value.trim(),
      reference: byId("reference").value.trim(),
      lines: [
        {
          description: byId("description").value.trim(),
          quantity: Number(byId("quantity").value),
          unitPriceCents: parseCents(byId("price").value),
        },
      ],
      taxBasisPoints: Number(byId("tax").value),
    };
    const serialized = JSON.stringify(body);
    if (pendingCreate?.serialized !== serialized)
      pendingCreate = { serialized, key: crypto.randomUUID() };
    await api("/api/v1/invoices", body, pendingCreate.key);
    pendingCreate = null;
    byId("invoice-form").reset();
    byId("estimate").textContent = "$0.00";
    notice("Borrador creado. Revisa el importe antes de emitirlo.");
    await refresh();
  } catch (error) {
    notice(error.message);
  } finally {
    byId("submit").disabled = false;
  }
});
fetch("/health/ready")
  .then((response) => {
    byId("health").textContent = response.ok
      ? "● Servicio disponible"
      : "Servicio no disponible";
  })
  .catch(() => {
    byId("health").textContent = "Sin conexión";
  });
