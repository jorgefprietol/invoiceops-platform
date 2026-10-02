# Evidencia de verificación

La evidencia automatizada se genera por ejecución en GitHub Actions. Los artifacts `verification-reports`, `release-api` y `release-web` corresponden a un commit y conservan comprobaciones operativas y digests de publicación. Este documento distingue implementación disponible y pruebas ejecutadas.

| Área | Verificación reproducible |
| --- | --- |
| Dominio | Dinero, límites, transiciones, permisos y validación de cursores |
| PostgreSQL | Ocho reintentos concurrentes, conflicto de payload, nueva instancia API, versiones y atomicidad |
| Roles y documentos | Operaciones permitidas/rechazadas, auditoría por función, PDF autenticado y cien líneas paginadas |
| Paginación | Recorrido sin duplicados con inserción entre páginas; cursores inválidos rechazados |
| Docker | Smoke contra las imágenes construidas, pérdida de DB, recovery y estado tras recreación |
| Observabilidad | Prometheus scrape, reglas validadas con promtool y dashboard provisionado |
| Kubernetes | Dos réplicas, rolling restart, conservación de factura, imagen rechazada y rollback |
| Seguridad | Auditoría npm y Grype; altas y críticas bloquean entrega |
| Publicación | Checksums e IDs de imágenes, GHCR, SBOM SPDX y attestations OIDC |

El resultado local final y el enlace a la primera ejecución completa se registran una vez terminadas las verificaciones. No se presentan como verificadas capacidades opcionales de HPA, enforcement de NetworkPolicy con kindnet, operación de Jenkins, HA de PostgreSQL ni despliegue cloud permanente.
