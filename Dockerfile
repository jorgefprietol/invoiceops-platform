# syntax=docker/dockerfile:1@sha256:4edf897a3ffa55b89f906fc8cc78afdb3f1834cc9c7083565e611a8a7d5fe99e
FROM node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS build
WORKDIR /app
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev --ignore-scripts --no-audit --no-fund

FROM cgr.dev/chainguard/glibc-dynamic:latest@sha256:82edc253a57efee78d0fb504e11a93b7c74687b1b736110ad3a2a4f3edf632ab
ARG REVISION=development
LABEL org.opencontainers.image.title="InvoiceOps API" \
      org.opencontainers.image.source="https://github.com/jorgefprietol/invoiceops-platform" \
      org.opencontainers.image.revision=$REVISION
ENV NODE_ENV=production PORT=8080 APP_REVISION=$REVISION
WORKDIR /app
# Keep the official Node 24 LTS binary on a patched, shell-free glibc base.
COPY --from=build /usr/local/bin/node /usr/local/bin/node
COPY --from=build /usr/local/LICENSE /usr/local/share/licenses/node/LICENSE
COPY --from=build --chown=65532:65532 /app/node_modules ./node_modules
COPY --from=build --chown=65532:65532 /app/dist/src ./dist/src
COPY --chown=65532:65532 package.json ./
COPY --chown=65532:65532 db ./db
COPY --chown=65532:65532 assets ./assets
USER 65532:65532
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=6 \
  CMD ["/usr/local/bin/node", "-e", "fetch('http://127.0.0.1:8080/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
STOPSIGNAL SIGTERM
ENTRYPOINT ["/usr/local/bin/node"]
CMD ["dist/src/main.js"]
