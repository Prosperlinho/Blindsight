# BlindSight enclave image. Build from the repository root so the shared lib/
# code (prompt, guard, NEAR AI attestation) is identical to the web server's:
#   docker build -f enclave/Dockerfile -t blindsight-enclave .
FROM node:22-alpine AS build
WORKDIR /src
COPY enclave/package.json enclave/package-lock.json enclave/
RUN cd enclave && npm ci --no-audit --no-fund
COPY lib/answerGuard.ts lib/datasetQuality.ts lib/enclaveProtocol.ts lib/privateAnswer.ts lib/privateInference.ts lib/
COPY enclave/src enclave/src
RUN cd enclave && npm run build && npm prune --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY --from=build /src/enclave/node_modules ./node_modules
COPY --from=build /src/enclave/dist ./dist
USER node
EXPOSE 8080
CMD ["node", "dist/server.mjs"]
