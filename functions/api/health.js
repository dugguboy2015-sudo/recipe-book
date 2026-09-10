export async function onRequestGet() {
  return new Response(JSON.stringify({ ok: true, time: new Date().toISOString() }), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
