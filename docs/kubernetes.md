# Operación de Kubernetes

## Cluster local y aceptación

```powershell
node scripts/kubernetes.mjs
kubectl --kubeconfig .artifacts/kubeconfig -n invoiceops get pods,pvc,pdb
kubectl --kubeconfig .artifacts/kubeconfig -n invoiceops port-forward service/web 18101:8080 --address 127.0.0.1
```

El script mantiene un kubeconfig separado y no cambia el contexto del usuario. Solo crea y modifica el cluster `invoiceops`. Carga las imágenes locales, provisiona Secrets con las credenciales existentes en `.env` y aplica Kustomize. Conserva el cluster al terminar para inspeccionarlo; CI lo elimina después de la aceptación.

La API usa dos réplicas, cero réplicas no disponibles durante rollout y una réplica adicional como máximo. Las probes distinguen disponibilidad de base de datos y proceso. Un PodDisruptionBudget exige una API disponible durante disrupciones voluntarias; no cubre la pérdida del nodo ni la base de datos.

PostgreSQL usa un StatefulSet de una réplica y PVC de 1 GiB. El cluster kind es de un nodo y no demuestra tolerancia a fallos de infraestructura. La prueba confirma que el estado sobrevive a una actualización de API, no a la eliminación de todo el cluster.

## Promover imágenes de GHCR

Verificar ambas attestations con `gh attestation verify oci://ghcr.io/jorgefprietol/invoiceops-platform-api@sha256:<digest> --repo jorgefprietol/invoiceops-platform`, repetir para web y usar los digests de los manifiestos de release.

Crear un overlay de Kustomize con `images` para reemplazar `invoiceops-api` y `invoiceops-web`, usando `newName` y `digest`. Aprovisionar Secrets fuera de Git y ejecutar `kubectl apply -k <overlay>` seguido de `kubectl rollout status deployment/api -n invoiceops` y una prueba funcional. No aplicar la base con referencias `:local` a un entorno remoto.

Para rollback de la API: `kubectl rollout undo deployment/api -n invoiceops`. Antes de una migración destructiva se requiere un procedimiento de backup y compatibilidad con el release anterior; el rollback de una imagen no revierte datos.

## Políticas y escalado

Las NetworkPolicies permiten web → API, API → PostgreSQL y DNS. La entrada a web se permite en 8080; limitarla al ingress real en un entorno compartido. Su enforcement requiere un CNI compatible. Kind usa kindnet en esta configuración, por lo que CI valida las definiciones y su aplicación, **no el bloqueo efectivo de tráfico**. Para comprobar aislamiento de red se debe instalar un CNI como Calico o Cilium y probar tráfico permitido y denegado.

`k8s/hpa.yaml` define escalado de CPU entre dos y cinco réplicas con objetivo 70 %. Requiere metrics-server; la aceptación básica no lo instala ni afirma haber probado autoescalado. Al habilitar HPA, retirar `replicas` de la definición gestionada por el overlay para evitar que un apply revierta su decisión.

El stack Prometheus/Grafana está provisionado para Compose. Una instalación Kubernetes compartida debería usar un stack de monitoreo del cluster con descubrimiento de cada pod y una política de ingreso para scraping; el Service API no garantiza métricas de todas las réplicas.

[Probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/) · [NetworkPolicies](https://kubernetes.io/docs/concepts/services-networking/network-policies/).
