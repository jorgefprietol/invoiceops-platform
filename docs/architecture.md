# Decisiones de arquitectura

## ADR-001 · Servicios con responsabilidad acotada

La API concentra un único agregado: la factura. Nginx sirve el workspace y actúa como proxy de mismo origen. PostgreSQL mantiene estado y auditoría. La separación permite actualizar y escalar la API sin reconstruir la interfaz, y evita ejecutar varios procesos de aplicación dentro de una misma imagen.

No se introduce un broker ni una malla de servicios porque la transacción cabe en una sola base de datos. Si la facturación se integra con contabilidad, un outbox transaccional sería el siguiente paso para conservar la entrega de eventos.

## ADR-002 · Dinero exacto

La entrada usa centavos y basis points. El cálculo intermedio usa `BigInt`; el impuesto se redondea half-up sobre el subtotal de la factura. La respuesta usa enteros JSON dentro de límites seguros. El total máximo es 1,000,000,000,000 centavos. Esta política no sustituye reglas fiscales de una jurisdicción específica.

## ADR-003 · Atomicidad, concurrencia e idempotencia

Cada mutación obtiene un bloqueo transaccional de PostgreSQL derivado de la clave de idempotencia. Una colisión de hash puede serializar solicitudes independientes, pero la tabla usa la clave completa para determinar identidad.

La solicitud normalizada incluye operación, identificador de factura y payload. Se calcula SHA-256. Si la clave existe con ese hash se devuelve el resultado original; un hash diferente devuelve 409. La fila de factura se bloquea con `FOR UPDATE` y se exige `expectedVersion`. Actualización, evento e idempotencia hacen commit juntos. Una excepción hace rollback de todo, permitiendo reutilizar una clave cuyo intento fue rechazado.

No se eliminan claves automáticamente: hacerlo permitiría volver a aplicar una operación antigua. La retención debe definirse con el cliente antes de crecer el volumen. La lista devuelve solo las 100 facturas más recientes; el resumen de la interfaz corresponde a ese conjunto, no a toda la historia.

## ADR-004 · Entrega verificable

Los jobs de aceptación construyen las imágenes, las ejecutan y las exportan. Publicación verifica checksums y los image IDs antes de subirlas. El digest del registry identifica el artefacto entregado; el commit identifica el código. La firma de procedencia respalda la ruta de construcción, pero no es una certificación de seguridad.

## ADR-005 · Salud y observabilidad

Liveness describe la capacidad del proceso para responder. Readiness consulta la tabla de facturas, por lo que una pérdida de PostgreSQL retira la API del tráfico sin pedir un reinicio del proceso saludable. El inicio de cada réplica ejecuta la migración idempotente con un bloqueo compartido de PostgreSQL.

La serie de métricas usa plantillas de ruta, método y código HTTP. No incluye nombres de clientes, tokens, UUIDs ni claves de idempotencia. Los logs JSON incluyen el request ID y ocultan Authorization y cookies. Los contadores de proceso se reinician al recrear una API; la auditoría comercial permanece en PostgreSQL.

## ADR-006 · Seguridad operacional

El usuario de aplicación puede crear sus objetos de esquema para ejecutar migraciones, pero no puede crear roles, bases de datos ni actuar como superusuario. El propietario de las tablas puede modificar la auditoría; la protección aquí es transaccional y de aplicación, no almacenamiento WORM. Una política de auditoría regulada requeriría separación adicional de privilegios.

Compose limita recursos y rota logs. Kubernetes restringe privilegios, no monta credenciales del service account y define políticas de red. La aplicación está dirigida a una instalación local de confianza; un despliegue externo necesita TLS, identidad y permisos por usuario.
