// Full-stack abuse check, run from two containers with fixed addresses on their own compose network (docker-compose.attack.yml):
//   attacker (ATTACKER_IP, default 172.31.77.50) floods the public edge (nginx) over HTTP and WebSocket, spoofs forwarding
//   headers to frame the victim, and brute-forces a login; legit (VICTIM_IP, default 172.31.77.51) keeps using the site.
// Pass criteria: the attacker is throttled; the legit client keeps being served fast.
const role = process.argv[2];
const TARGET = process.env.TARGET ?? 'http://nginx';
const SECONDS = Number(process.env.DURATION_S ?? 20);
const VICTIM_IP = process.env.VICTIM_IP ?? '172.31.77.51';
const Q = JSON.stringify({ query: '{ clinics { id city } }' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const p95 = (xs) =>
  [...xs].sort((a, b) => a - b)[Math.max(0, Math.ceil(xs.length * 0.95) - 1)] ?? 0;
const post = async (body = Q, headers = {}) => {
  const t0 = performance.now();
  try {
    const r = await fetch(`${TARGET}/graphql`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body,
      signal: AbortSignal.timeout(5000),
    });
    await r.text();
    return { status: r.status, ms: performance.now() - t0 };
  } catch {
    return { status: 0, ms: performance.now() - t0 };
  }
};

const wsOpen = (headers = {}) =>
  new Promise((resolve) => {
    const ws = new WebSocket(`${TARGET.replace('http', 'ws')}/graphql`, 'graphql-transport-ws', {
      headers,
    });
    const t = setTimeout(() => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      resolve({ ok: false, ws: null });
    }, 4000);
    ws.onopen = () => ws.send(JSON.stringify({ type: 'connection_init' }));
    ws.onmessage = (m) => {
      if (JSON.parse(m.data).type === 'connection_ack') {
        clearTimeout(t);
        resolve({ ok: true, ws });
      }
    };
    ws.onerror = () => {
      clearTimeout(t);
      resolve({ ok: false, ws: null });
    };
    ws.onclose = () => {
      clearTimeout(t);
      resolve({ ok: false, ws: null });
    };
  });

if (role === 'attacker') {
  const stats = { 200: 0, 429: 0, other: 0 };
  const end = Date.now() + SECONDS * 1000;
  const spoof = { 'x-forwarded-for': VICTIM_IP, 'x-real-ip': VICTIM_IP };
  const flood = async () => {
    while (Date.now() < end) {
      const r = await post(Q, spoof);
      stats[r.status === 200 ? 200 : r.status === 429 ? 429 : 'other']++;
    }
  };
  const login = async () => {
    let limited = 0;
    for (let i = 0; Date.now() < end; i++) {
      const r = await post(
        JSON.stringify({
          query: 'mutation($i: SignInInput!){ signIn(input:$i){ id } }',
          variables: { i: { email: 'manager@demo.local', password: `guess-${i}-xxxxxx` } },
        }),
        spoof,
      );
      if (r.status === 429) limited++;
      await sleep(50);
    }
    return limited;
  };
  const sockets = [];
  const wsFlood = async () => {
    let refused = 0;
    for (let i = 0; i < 200; i++) {
      const r = await wsOpen(spoof);
      if (r.ok) sockets.push(r.ws);
      else refused++;
    }
    return refused;
  };
  const [, , limitedLogins, refusedWs] = await Promise.all([
    Promise.all(Array.from({ length: 150 }, flood)),
    sleep(0),
    login(),
    wsFlood(),
  ]);
  sockets.forEach((s) => s.close());
  const total = stats[200] + stats[429] + stats.other;
  console.log(
    'ATTACKER',
    JSON.stringify({
      total,
      ...stats,
      limitedLogins,
      wsOpened: sockets.length,
      wsRefused: refusedWs,
    }),
  );
  const ok = stats[429] > total * 0.5 && limitedLogins > 0 && sockets.length < 100;
  console.log(ok ? 'ATTACKER throttled as expected' : 'ATTACKER was NOT throttled enough');
  process.exit(ok ? 0 : 1);
}

if (role === 'legit') {
  await sleep(1500); // let the attack start
  const times = [];
  let good = 0;
  let total = 0;
  const hold = await wsOpen();
  const end = Date.now() + SECONDS * 1000;
  while (Date.now() < end) {
    const r = await post();
    total++;
    times.push(r.ms);
    if (r.status === 200) good++;
    const page = await fetch(`${TARGET}/en`)
      .then((x) => x.status)
      .catch(() => 0);
    total++;
    if (page === 200) good++;
    await sleep(200);
  }
  const wsStillOpen = hold.ok && hold.ws && hold.ws.readyState === 1;
  hold.ws?.close();
  const rate = good / total;
  console.log(
    'LEGIT',
    JSON.stringify({
      requests: total,
      ok: good,
      successRate: Number(rate.toFixed(4)),
      p95ms: Math.round(p95(times)),
      wsConnected: hold.ok,
      wsStillOpen,
    }),
  );
  const pass = rate >= 0.99 && p95(times) < 500 && hold.ok && wsStillOpen;
  console.log(
    pass ? 'LEGIT served normally during the attack' : 'LEGIT was DEGRADED by the attack',
  );
  process.exit(pass ? 0 : 1);
}
