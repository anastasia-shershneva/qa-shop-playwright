const base = process.env.DEPLOY_URL || 'http://127.0.0.1:10000';

async function check(path, predicate) {
  let lastError;
  for (let attempt = 0; attempt < 24; attempt += 1) {
    try {
      const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json();
      if (!predicate(body)) throw new Error('Unexpected response');
      console.log(`OK ${path}`);
      return;
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
  throw new Error(`${path}: ${lastError.message}`);
}

await check('/api/health', body => body.app === 'qa-shop' && body.status === 'ok');
await check('/api/products', body => Array.isArray(body) && body.length === 16);
await check('/grafana/api/health', body => body.database === 'ok');
await check('/grafana/api/dashboards/uid/qa-shop', body => {
  const panels = body.dashboard?.panels;
  if (!Array.isArray(panels)) return false;
  return [
    [5, 'sum(shop_orders_total{job="qa-shop"}) or vector(0)'],
    [6, 'sum(shop_revenue_rub_total{job="qa-shop"}) or vector(0)'],
  ].every(([id, expression]) => {
    const panel = panels.find(item => item.id === id);
    return panel?.targets?.[0]?.expr === expression && panel.targets[0].instant === true
      && panel.options?.reduceOptions?.calcs?.[0] === 'lastNotNull';
  });
});
for (const expression of [
  'sum(shop_orders_total{job="qa-shop"}) or vector(0)',
  'sum(shop_revenue_rub_total{job="qa-shop"}) or vector(0)',
]) {
  await check(`/grafana/api/datasources/proxy/uid/prometheus/api/v1/query?query=${encodeURIComponent(expression)}`,
    body => body.status === 'success' && body.data.result.length === 1
      && Number.isFinite(Number(body.data.result[0].value[1])));
}
await check('/grafana/api/datasources/proxy/uid/prometheus/api/v1/query?query=up', body =>
  body.status === 'success' && body.data.result.some(series =>
    series.metric.job === 'qa-shop' && series.value[1] === '1'));

const metrics = await fetch(`${base}/metrics`);
if (!metrics.ok || !(await metrics.text()).includes('shop_orders_total')) {
  throw new Error('Shop metrics are unavailable');
}
console.log('OK /metrics');
