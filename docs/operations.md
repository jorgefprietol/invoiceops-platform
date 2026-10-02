# Operación y recuperación

## Estado y diagnósticos

```powershell
docker compose --profile observability ps
docker compose logs --tail 100 api web postgres
Invoke-RestMethod http://127.0.0.1:18100/health/ready
npm run smoke
```

El smoke crea una factura identificada como verificación, la emite, registra su cobro y verifica tres eventos. Cada ejecución deja ese registro visible para inspección. El dashboard resume tráfico, estado del scrape, operaciones y uso de memoria. Los contadores son del proceso, no un libro contable acumulado.

## Indisponibilidad de PostgreSQL

La API responde 503 en readiness y 200 en liveness. Recuperar la conexión y verificar readiness antes de aceptar cambios. En Compose no existe un balanceador que retire automáticamente un contenedor por su healthcheck; en Kubernetes el Service sí usa readiness para seleccionar endpoints.

`node scripts/verify-operations.mjs` detiene y reinicia PostgreSQL de este proyecto, recrea API y web y verifica que factura e idempotencia permanezcan. No ejecutar en una instalación con trabajo comercial activo. La prueba conserva los datos de los volúmenes.

## Backup

```powershell
New-Item -ItemType Directory backups -Force
docker compose exec -T postgres pg_dump -U postgres -d invoiceops -Fc -f /tmp/invoiceops.dump
docker compose cp postgres:/tmp/invoiceops.dump ./backups/invoiceops.dump
docker compose exec -T postgres rm /tmp/invoiceops.dump
```

El formato binario se copia desde el contenedor para evitar redirección de binarios por PowerShell. Conservar el archivo cifrado en otro sistema, validar checksum y probar restauración en una instancia separada. La copia contiene datos de facturas y respuestas idempotentes; no contiene roles de PostgreSQL. Inicializar los mismos roles en el destino y restaurar con `pg_restore`. No se promete un RPO/RTO sin medir una restauración bajo condiciones del entorno objetivo.

## Actualizar y recuperar

Guardar los digests actuales de API y web. Verificar la procedencia de los nuevos digests, definir `API_IMAGE` y `WEB_IMAGE` en `.env` y ejecutar `docker compose --profile observability up -d --no-build --wait`. Ejecutar smoke. Si falla una verificación y el esquema sigue siendo compatible, restablecer los digests previos y repetir `up` y readiness.

La migración inicial crea tablas de forma idempotente. Una evolución futura necesita nuevas migraciones versionadas, cambios compatibles con versiones consecutivas y validación de backup. `docker compose down` conserva volúmenes; `down --volumes` elimina datos y se reserva para instancias desechables. No eliminar volúmenes para resolver un problema de arranque.

## Credenciales

`npm run init` preserva `.env` existente. Los secretos de PostgreSQL se aplican en su primer arranque: cambiar únicamente el archivo no modifica contraseñas de una base ya inicializada. Una rotación requiere cambiar el rol dentro de PostgreSQL y actualizar las conexiones de forma coordinada. Grafana también conserva estado de usuario en su volumen.
