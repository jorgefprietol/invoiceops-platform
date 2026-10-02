# Entrega y control de versiones

## GitFlow adaptado

- `main`: estado entregable; toda modificación debe superar los checks.
- `develop`: integración de trabajo en curso, con los mismos controles de calidad.
- `feature/*`: capacidades acotadas con pull request hacia `develop`.
- `release/*`: estabilización y revisión hacia `main`; después se sincroniza `develop`.
- `hotfix/*`: corrección desde `main`, validada y propagada a `develop`.

En un proyecto con un único mantenedor no se exige una aprobación propia imposible de conceder. Los checks y la resolución de conversaciones protegen `main`. En un equipo se agregarían revisores y separación de funciones. Los tags de release son referencias a commits ya verificados; el workflow publica en cada push a main usando `sha-<commit>`.

## Jobs de GitHub Actions

1. **Quality and PostgreSQL integration**: lockfile, formato, lint, tipos, dominio, integración con PostgreSQL, auditoría de dependencias, Compose, reglas Prometheus y actionlint.
2. **Containers and Kubernetes acceptance**: construye API y web, ejecuta smoke, interrumpe PostgreSQL, verifica recuperación y persistencia, comprueba scrape y despliega en kind. Prueba un rollout inválido y rollback. Grype bloquea vulnerabilidades altas y críticas incluyendo las que no tengan parche. Genera SBOM SPDX para ambas imágenes.
3. **Publish tested image**: solamente main, verifica el artefacto exportado, publica API y web en GHCR y genera attestations de procedencia y SBOM con OIDC.

Las actions y las bases de imagen están fijadas por hash. Dependabot propone actualizaciones. PostgreSQL de integración y secretos generados en el runner son desechables y no son credenciales de una instalación permanente. Los pull requests usan runners de GitHub y no acceden al equipo local.

Los reportes duran 30 días, las imágenes exportadas dos días y los manifiestos de release 90 días. El kubeconfig y las credenciales temporales no se suben como artifacts. Una publicación incompleta no debe desplegarse: revisar que el mismo commit tenga ambos manifiestos y attestations válidas.

## Jenkins

`Jenkinsfile` ejecuta los mismos comandos de calidad y smoke en un agente `linux-docker-node24`. El agente requiere Docker, Compose, Node.js 24 y acceso a registries. La alternativa no instala Jenkins ni publica en GHCR. Los agentes deben tener un workspace aislado y la exclusión de ejecución simultánea evita colisiones con tags locales.

## Referencias técnicas

- [Publicación de imágenes con GitHub Actions](https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images).
- [Attestations de artefactos](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations).
- [Pipeline de Jenkins y Docker](https://www.jenkins.io/doc/book/pipeline/docker/).
