const JSON_BODY_MAX = 64 * 1024;

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  });
}

/** 以 64KB 為上限讀 JSON 物件；格式錯誤或非物件一律回 null。 */
export async function readJsonBody(request) {
  try {
    const length = request.headers.get('content-length');
    if (length !== null && Number(length) > JSON_BODY_MAX) return null;
    const text = await request.text();
    if (text.length > JSON_BODY_MAX) return null;
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}
