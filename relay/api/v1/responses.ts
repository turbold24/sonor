// Sonor's model relay, a Vercel function. The Meta Model API offers no models to requests
// from the deployed API's network, so the API sends its Responses API calls here and this
// forwards them to Meta unchanged. It relays only POST /v1/responses, only for callers
// with the relay secret, and keeps nothing: no logging of bodies, keys or replies.

declare const process: { env: Record<string, string | undefined> };

const UPSTREAM = 'https://api.meta.ai/v1/responses';
const PASSED_BACK = ['content-type', 'retry-after', 'x-request-id'];

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.RELAY_SECRET;
  const given = request.headers.get('x-relay-secret') ?? '';
  if (!secret || !sameSecret(given, secret)) {
    return new Response('Forbidden', { status: 403 });
  }

  const upstream = await fetch(UPSTREAM, {
    method: 'POST',
    headers: {
      authorization: request.headers.get('authorization') ?? '',
      'content-type': 'application/json',
    },
    body: await request.text(),
  });

  const headers = new Headers();
  for (const name of PASSED_BACK) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}

/** Compares in time that doesn't depend on where the strings differ. */
function sameSecret(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
