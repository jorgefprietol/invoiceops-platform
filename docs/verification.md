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

## Resultado ejecutado · 2 de octubre de 2026

La [ejecución 37056053522](https://github.com/jorgefprietol/invoiceops-platform/actions/runs/37056053522), sobre `52f0869e6c7da3393d985264a2973386364a991f`, completó correctamente calidad e integración, aceptación Docker/Kubernetes y publicación de API/web. Sus artifacts conservan los reportes operativos, análisis SARIF, SBOM SPDX y manifiestos de release. El control de seguridad permaneció en severidad alta, incluyendo vulnerabilidades sin parche; la imagen web utiliza un runtime Nginx mínimo fijado por digest.

`npm run verify` también terminó localmente con **13 pruebas aprobadas, cero fallos y cero omisiones**, usando PostgreSQL temporal provisionado y eliminado por el propio comando. `npm audit --audit-level=high` no detectó vulnerabilidades en las dependencias de aplicación.

La revisión de interfaz ejecutó autenticación de administración/emisión/cobro, creación y emisión, cobro con la credencial de collector, historial con roles y versiones, descarga PDF y navegación de página 1 a 2 y regreso. El formulario calculó y conservó `$385.25` para dos unidades de `$167.50` con impuesto del 15 %. Cobro oculta creación, emisión y anulación. La revisión utilizó la API compilada y PostgreSQL real en un preview local; la aceptación del proxy Nginx se ejecutó separadamente en Actions. Las [capturas de escritorio](images/workspace.png) y [móvil](images/mobile.png) contienen únicamente datos sintéticos.

El [PDF de ejemplo](../output/pdf/invoiceops-sample.pdf) se renderizó y revisó visualmente. Se comprobó un documento adicional de **100 líneas y 11 páginas**, incluyendo acentos, encabezados, numeración, totalidad de líneas y el total final de `$22,997.70`.

## Imágenes verificadas

| Componente | Referencia inmutable |
| --- | --- |
| API | `ghcr.io/jorgefprietol/invoiceops-platform-api@sha256:69d0b0f571f318b74b8d4072fc1b156174f5f7c7b0a61c9e7c4fb49a22cee6c6` |
| Web | `ghcr.io/jorgefprietol/invoiceops-platform-web@sha256:bd830f01ac46c8bdf22846d4c98a818706828bcb701de6eeb62b047e6a6ed121` |

Estas referencias corresponden a la ejecución enlazada, no necesariamente al HEAD futuro de main. Para una actualización, usar los dos manifiestos de release del mismo commit y revisar sus attestations.

Ambos manifests respondieron HTTP 200 con autenticación anónima del registry y devolvieron los digests esperados. Las imágenes pueden descargarse sin iniciar sesión. `gh attestation verify oci://<imagen>@<digest> --repo jorgefprietol/invoiceops-platform --deny-self-hosted-runners` terminó correctamente para API y web.

Los servicios locales de Compose se dejaron detenidos para liberar memoria, conservando los volúmenes. Se restauran desde la raíz del repositorio con `docker compose --profile observability up --build -d --wait --wait-timeout 300`; no hay un cluster kind local creado por este proyecto. El preview temporal de revisión se cierra al terminar.

No se presentan como verificadas capacidades opcionales de HPA, enforcement de NetworkPolicy con kindnet, operación de Jenkins, HA de PostgreSQL ni despliegue cloud permanente.
