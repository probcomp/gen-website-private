const headersToDelete = [
	'pragma', 'cache-control', 'expires', 'etag', 'last-modified',
	'x-cloud-trace-context', 'x-appengine-resource-usage',
	'x-powered-by', 'x-cache-info'
];

const CACHE_POLICIES = {
    HTML: { maxAge: 60, visibility: 'private', staleWhileRevalidate: 30 },
    STATIC: { maxAge: 86400, visibility: 'public', staleWhileRevalidate: 3600 }, // 24 hours
    LARGE_BINARY: { maxAge: 31536000, visibility: 'public', immutable: true }, // 1 year
};

const getCachePolicy = (pathname, contentType) => {
    // Handle root-like paths first
    if (pathname === '/' || pathname.endsWith('/') || !pathname.includes('.')) {
        return CACHE_POLICIES.HTML;
    }

    const ext = pathname.split('.').pop().toLowerCase();

    if (['wasm', 'data'].includes(ext)) {
        return CACHE_POLICIES.LARGE_BINARY;
    }
    // More specific content type check
    if (contentType?.toLowerCase().includes('text/html')) {
        return CACHE_POLICIES.HTML;
    }
    return CACHE_POLICIES.STATIC;
};

async function handleLargeFile(request, response, ext, ctx) {
  const url = new URL(request.url);
  const cache = caches.default;

  // Try cache first
  let cachedResponse = await cache.match(request);
  if (cachedResponse) {
    const modifiedResponse = new Response(cachedResponse.body, cachedResponse);
    modifiedResponse.headers.set('X-Cache-Status', 'HIT');
    return modifiedResponse;
  }

  const modifiedResponse = new Response(response.body, response);

  headersToDelete.forEach(header => modifiedResponse.headers.delete(header));

  // Set strong caching headers
  modifiedResponse.headers.set('Cache-Control', 'public, max-age=31536000, immutable'); // 1 year
  modifiedResponse.headers.set('Vary', 'Accept-Encoding');
  modifiedResponse.headers.set('X-Cache-Status', 'MISS');

  // Cache the response
  ctx.waitUntil(cache.put(request, modifiedResponse.clone()));

  return modifiedResponse;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const response = await fetch(request);

    // Never cache any IAP-related responses
    if (
        // IAP authentication flow
        url.searchParams.has('gcp-iap-mode') ||
        // IAP-generated responses
        response.headers.get('x-goog-iap-generated-response') === 'true' ||
        // Redirects to IAP or Google auth
        (response.status === 302 &&
         response.headers.get('location')?.includes('iap.googleapis.com'))
    ) {
        console.log('Bypassing cache for IAP-related response:', {
            url: request.url,
            location: response.headers.get('location')
        });
        return response;
    }

    const ext = url.pathname.split('.').pop().toLowerCase();

    // Handle large binary files with Cache API
    if (['wasm', 'data'].includes(ext)) {
      return handleLargeFile(request, response, ext, ctx);
    }

    const modifiedResponse = new Response(response.body, response);
    headersToDelete.forEach(header => modifiedResponse.headers.delete(header));

    // Apply cache policy based on content type
    const contentType = response.headers.get('Content-Type');
    const policy = getCachePolicy(url.pathname, contentType);

    const cacheControl = policy.immutable
        ? `${policy.visibility}, max-age=${policy.maxAge}, immutable`
        : `${policy.visibility}, max-age=${policy.maxAge}, stale-while-revalidate=${policy.staleWhileRevalidate}`;

    modifiedResponse.headers.set('Cache-Control', cacheControl);
    modifiedResponse.headers.set('Vary', 'Accept-Encoding');

    // Get ETag and Last-Modified from X-File-Info
    const fileInfoHeader = response.headers.get('X-File-Info');
    if (fileInfoHeader) {
        try {
            const fileInfo = JSON.parse(fileInfoHeader);
            if (fileInfo.etag) {
                modifiedResponse.headers.set('ETag', fileInfo.etag);
            }
            if (fileInfo.lastModified) {
                modifiedResponse.headers.set('Last-Modified', fileInfo.lastModified);
            }
        } catch (e) {
            console.error('Failed to parse file info:', e);
        }
    }

    return modifiedResponse;
  }
};
