export function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') ?? '0.0.0.0';
}

export async function hashIp(ip, salt) {
  const data = new TextEncoder().encode(salt + ip);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
