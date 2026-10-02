# Contribuir

Crear una rama acotada desde `develop`, describir el cambio y abrir un pull request. Ejecutar `npm ci --ignore-scripts` y `npm run verify`. Cambios de persistencia necesitan integración PostgreSQL; cambios de infraestructura necesitan aceptación de contenedores y Kubernetes.

Mantener cambios de esquema compatibles con la API anterior. No incluir `.env`, kubeconfigs, backups ni información de clientes. Los cambios de comportamiento deben actualizar contrato, pruebas y documentación operativa. Consultar [flujo de entrega](docs/delivery.md).
