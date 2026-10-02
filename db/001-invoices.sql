CREATE TABLE IF NOT EXISTS invoices (
    id UUID PRIMARY KEY,
    document JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (document->>'status' IN ('draft', 'issued', 'paid', 'void')),
    CHECK ((document->>'totalCents')::BIGINT > 0)
);
CREATE INDEX IF NOT EXISTS invoices_created_at ON invoices(created_at DESC);
CREATE TABLE IF NOT EXISTS invoice_events (
    invoice_id UUID NOT NULL REFERENCES invoices(id),
    version INTEGER NOT NULL CHECK (version > 0),
    event_type TEXT NOT NULL CHECK (event_type IN ('created', 'issue', 'pay', 'void')),
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (invoice_id, version)
);
CREATE TABLE IF NOT EXISTS idempotency (
    key TEXT PRIMARY KEY,
    request_hash TEXT NOT NULL,
    response JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
