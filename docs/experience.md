# InvoiceOps · Ingeniería de plataforma y entrega de software

**Autor:** Jorge Prieto · **Tipo:** proyecto de ingeniería independiente · **Periodo:** octubre de 2026.

Diseñé e implementé una plataforma de facturación con API TypeScript y PostgreSQL, interfaz operativa y trazabilidad de cambios. Construí imágenes Docker independientes para frontend y backend, segmenté redes y almacenamiento, y definí el despliegue declarativo en Kubernetes con probes, límites de recursos y estrategias de actualización.

Automaticé calidad, integración con base de datos real, aceptación de contenedores, pruebas de rollout y rollback, análisis de vulnerabilidades y publicación de imágenes en GitHub Container Registry mediante GitHub Actions. Incorporé métricas de Prometheus, dashboards provisionados en Grafana y procedimientos operativos para diagnóstico y recuperación.

## Contribuciones técnicas

- Idempotencia transaccional persistente y control de versiones para proteger operaciones concurrentes.
- Cálculo monetario exacto y ciclo de vida de facturas con auditoría por versión.
- Imágenes de aplicación sin privilegios y entrega por digest, con SBOM y procedencia firmada.
- Validación de disponibilidad frente a pérdida de la base de datos, recreación de contenedores y releases fallidos.
- Documentación de arquitectura, API, operación y flujo de contribución GitFlow.

## Texto breve para portafolio

**InvoiceOps — DevOps y plataforma de facturación.** Implementación de servicios contenerizados con PostgreSQL, despliegue Kubernetes, integración y entrega con GitHub Actions, seguridad de imágenes y observabilidad Prometheus/Grafana. Diseño de idempotencia, concurrencia transaccional y procedimientos verificables de recuperación.

Cada afirmación debe acompañarse del repositorio y su evidencia de verificación. La definición de un Jenkinsfile y un HPA se documenta como configuración disponible; no equivale a haber operado Jenkins o autoescalado en un entorno productivo. No se atribuyen métricas comerciales, experiencia de clientes ni disponibilidad medida en producción.
