FROM node:22-bookworm-slim AS shop-build
WORKDIR /build
COPY qa-shop/package*.json ./
RUN npm ci --omit=dev --ignore-scripts

FROM prom/prometheus:v3.13.5 AS prometheus

FROM grafana/grafana:13.3.1-ubuntu
USER root
RUN apt-get update && apt-get install -y --no-install-recommends nginx tini ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=shop-build /usr/local/bin/node /usr/local/bin/node
COPY --from=shop-build /build/node_modules /app/qa-shop/node_modules
COPY --from=prometheus /bin/prometheus /usr/local/bin/prometheus
COPY qa-shop /app/qa-shop
COPY monitoring /app/monitoring
COPY deploy /app/deploy
RUN mkdir -p /data/shop /data/prometheus /data/grafana /tmp/nginx && chown -R 472:0 /app /data /tmp/nginx
USER 472
WORKDIR /app
ENV PORT=10000
EXPOSE 10000
ENTRYPOINT ["/usr/bin/tini", "--", "/bin/bash", "/app/deploy/start.sh"]
