#!/bin/bash
set -euo pipefail

port=${PORT:-10000}
case "$port" in
  ''|*[!0-9]*) echo 'PORT must be a number' >&2; exit 1 ;;
esac

mkdir -p /tmp/grafana-provisioning
cp -r /app/monitoring/provisioning/. /tmp/grafana-provisioning/
sed -i 's|http://prometheus:9090|http://127.0.0.1:9090|' /tmp/grafana-provisioning/datasources/prometheus.yml
sed -i 's|/var/lib/grafana/dashboards|/app/monitoring/dashboards|' /tmp/grafana-provisioning/dashboards/default.yml
sed "s/__PORT__/$port/g" /app/deploy/nginx.conf > /tmp/nginx/nginx.conf

export GF_PATHS_DATA=/data/grafana
export GF_PATHS_LOGS=/tmp/grafana-logs
export GF_PATHS_PLUGINS=/tmp/grafana-plugins
export GF_PATHS_PROVISIONING=/tmp/grafana-provisioning
export GF_SERVER_HTTP_ADDR=127.0.0.1
export GF_SERVER_HTTP_PORT=3301
export GF_SERVER_ROOT_URL="${RENDER_EXTERNAL_URL:-http://localhost:$port}/grafana/"
export GF_SERVER_SERVE_FROM_SUB_PATH=true
export GF_AUTH_ANONYMOUS_ENABLED=true
export GF_AUTH_ANONYMOUS_ORG_ROLE=Viewer
export GF_USERS_ALLOW_SIGN_UP=false
export GF_ANALYTICS_REPORTING_ENABLED=false
export GF_ANALYTICS_CHECK_FOR_UPDATES=false
export GF_PLUGINS_PREINSTALL_DISABLED=true
export GF_LOG_LEVEL=warn
export GF_SECURITY_ADMIN_PASSWORD="${GRAFANA_ADMIN_PASSWORD:-$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))")}"

PORT=3000 DATA_DIR=/data/shop ALLOW_TEST_RESET=0 node /app/qa-shop/server.js &
shop_pid=$!
prometheus --config.file=/app/deploy/prometheus.yml --storage.tsdb.path=/data/prometheus --storage.tsdb.retention.time=24h --storage.tsdb.retention.size=100MB --web.listen-address=127.0.0.1:9090 --log.level=warn &
prometheus_pid=$!
/usr/share/grafana/bin/grafana server --homepath=/usr/share/grafana &
grafana_pid=$!
nginx -c /tmp/nginx/nginx.conf -g 'daemon off;' &
nginx_pid=$!

shutdown() {
  trap - TERM INT EXIT
  kill -TERM "$shop_pid" "$prometheus_pid" "$grafana_pid" "$nginx_pid" 2>/dev/null || true
  wait || true
}
trap shutdown TERM INT EXIT

# При падении любого сервиса завершаем контейнер, чтобы платформа перезапустила его.
set +e
wait -n "$shop_pid" "$prometheus_pid" "$grafana_pid" "$nginx_pid"
status=$?
set -e
if [ "$status" -eq 0 ]; then status=1; fi
exit "$status"
