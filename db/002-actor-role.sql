ALTER TABLE invoice_events ADD COLUMN IF NOT EXISTS actor_role TEXT NOT NULL DEFAULT 'system';
ALTER TABLE invoice_events ADD CONSTRAINT invoice_events_actor_role CHECK (actor_role IN ('admin', 'issuer', 'collector', 'system'));
