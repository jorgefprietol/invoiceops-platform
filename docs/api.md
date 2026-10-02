# Contrato HTTP

Base local: `http://127.0.0.1:18100`. Las rutas `/api/` requieren `Authorization: Bearer <API_TOKEN>`. Cuerpos JSON limitados a 64 KiB y campos desconocidos rechazados.

| Método | Ruta | Resultado |
| --- | --- | --- |
| GET | `/health/live` | 200: proceso vivo y revisión |
| GET | `/health/ready` | 200: PostgreSQL accesible; 503: no disponible |
| GET | `/api/v1/invoices` | Últimas 100 facturas |
| GET | `/api/v1/invoices/{id}` | Factura por UUID |
| GET | `/api/v1/invoices/{id}/events` | Eventos ordenados por versión |
| POST | `/api/v1/invoices` | 201: nuevo borrador |
| POST | `/api/v1/invoices/{id}/issue` | 200: emisión |
| POST | `/api/v1/invoices/{id}/pay` | 200: registro de cobro |
| POST | `/api/v1/invoices/{id}/void` | 200: anulación |

`/metrics` está disponible en el puerto interno de la API; Nginx no lo expone.

## Crear una factura

```json
{
  "customer": "Acme Operations",
  "reference": "PO-2026-001",
  "lines": [{ "description": "Platform engineering", "quantity": 2, "unitPriceCents": 12000 }],
  "taxBasisPoints": 1500
}
```

Subtotal 24,000 centavos, impuesto 3,600 y total 27,600. Moneda fija USD. Entre 1 y 100 líneas; cantidades enteras de 1 a 10,000; precio entre 1 y 100,000,000 centavos; impuesto entero entre 0 y 2,500 basis points. El formulario web permite una línea; la API admite hasta cien.

Todas las mutaciones requieren `Idempotency-Key`: entre 8 y 128 caracteres alfanuméricos, guion o guion bajo. Conservar la clave cuando se reintenta la misma operación después de un timeout. La respuesta incluye `Idempotency-Replayed: true|false`. La repetición de creación conserva el código 201 y el resultado original, aunque el estado de la factura haya avanzado; consultar GET para obtener el estado vigente.

Las transiciones requieren `{ "expectedVersion": 1 }`. El contador inicia en 1 y crece al confirmar cada movimiento.

## Errores

```json
{ "code": "version_conflict", "requestId": "req-12" }
```

| HTTP | Códigos |
| --- | --- |
| 400 | `invalid_request` |
| 401 | `unauthorized` |
| 404 | `invoice_not_found` |
| 409 | `version_conflict`, `invalid_transition`, `idempotency_conflict` |
| 422 | `invoice_limit_exceeded` |
| 500 | `internal_error` |

Ante 409 por versión, consultar nuevamente, revisar el estado y decidir una nueva operación con otra clave. No reintentar automáticamente una decisión comercial sobre una versión distinta.
