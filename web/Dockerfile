FROM golang:1.27-alpine@sha256:8a5910f31396cd4d89662f56c68b3ae31d374308270a1c3bd96672ee5ed43414 AS probe
WORKDIR /src
COPY web/healthcheck.go ./healthcheck.go
RUN CGO_ENABLED=0 GO111MODULE=off GOTOOLCHAIN=local go build -trimpath -ldflags="-s -w -buildid=" -o /http-healthcheck healthcheck.go

FROM cgr.dev/chainguard/nginx:latest@sha256:a104d1995e56b7a15e8f152078dfbdb1ecbf9f9d1af311e7906e7b4c0c790cf2
ARG REVISION=development
LABEL org.opencontainers.image.title="InvoiceOps Workspace" \
      org.opencontainers.image.source="https://github.com/jorgefprietol/invoiceops-platform" \
      org.opencontainers.image.revision=$REVISION
COPY --from=probe /http-healthcheck /usr/local/bin/http-healthcheck
COPY web/main.conf /etc/nginx/nginx.conf
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
COPY web/index.html web/style.css web/app.js /usr/share/nginx/html/
USER 65532:65532
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=6 \
  CMD ["/usr/local/bin/http-healthcheck"]
ENTRYPOINT ["/usr/sbin/nginx"]
CMD ["-g", "daemon off;"]
