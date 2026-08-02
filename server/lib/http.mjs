function securityHeaders(extra = {}) {
  return {
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    ...extra,
  };
}

export function json(response, status, payload, headers = {}) {
  const body = payload == null ? '' : JSON.stringify(payload);
  response.writeHead(status, securityHeaders({
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    ...headers,
  }));
  response.end(body);
}

export function noContent(response, headers = {}) {
  response.writeHead(204, securityHeaders({ 'cache-control': 'no-store', ...headers }));
  response.end();
}

export async function readJson(request, limitBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limitBytes) {
      const error = new Error('Požadavek je příliš velký.');
      error.status = 413;
      error.code = 'request_too_large';
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('Tělo požadavku není platný JSON.');
    error.status = 400;
    error.code = 'json_invalid';
    throw error;
  }
}

export function requestIp(request) {
  return String(request.socket.remoteAddress || 'unknown');
}

export function binary(response, status, payload, { contentType = 'application/octet-stream', fileName = '', headers = {} } = {}) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload || '');
  response.writeHead(status, securityHeaders({
    'content-type': contentType,
    'content-length': body.length,
    'cache-control': 'private, no-store',
    ...(fileName ? { 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}` } : {}),
    ...headers,
  }));
  response.end(body);
}
