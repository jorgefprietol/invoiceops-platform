FROM nginxinc/nginx-unprivileged:stable-alpine@sha256:ed04ec1ff34502c339ee5c3ae3f855442398edc1d05591e2b98981dcbbd20b1e
ARG REVISION=development
LABEL org.opencontainers.image.title="InvoiceOps Workspace" \
      org.opencontainers.image.source="https://github.com/jorgefprietol/invoiceops-platform" \
      org.opencontainers.image.revision=$REVISION
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
COPY web/index.html web/style.css web/app.js /usr/share/nginx/html/
USER 101:101
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=6 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/health/live || exit 1
ENTRYPOINT ["nginx"]
CMD ["-g", "daemon off;"]
