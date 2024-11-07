export default {
  async fetch(request, env, ctx) {
    const response = await fetch(request);

    // Check for custom cache info
    const cacheInfoHeader = response.headers.get('X-Cache-Info');
    if (cacheInfoHeader) {
      try {
        const cacheInfo = JSON.parse(cacheInfoHeader);
        const modifiedResponse = new Response(response.body, response);
        const url = new URL(request.url);
        const ext = url.pathname.split('.').pop().toLowerCase();

        // Clear any existing cache headers
        const headersToDelete = [
          'Pragma', 'Cache-Control', 'Expires', 'ETag', 'Last-Modified',
          'x-cloud-trace-context', 'x-appengine-resource-usage',
          'cf-cache-status', 'cf-ray', 'x-powered-by'
        ];
        headersToDelete.forEach(header => modifiedResponse.headers.delete(header));

        // Restore cache control headers
        const { policy, expires, etag, lastModified, contentLength } = cacheInfo;

        // Handle conditional requests
        const ifNoneMatch = request.headers.get('If-None-Match');
        const ifModifiedSince = request.headers.get('If-Modified-Since');

        // Add immutable flag for certain file types
        const isImmutable = ['wasm', 'data'].includes(ext);
        let cacheControl = `${policy.visibility}, max-age=${policy.maxAge}, stale-while-revalidate=${policy.staleWhileRevalidate}`;
        if (isImmutable) {
          cacheControl += ', immutable';
        }

        // Return 304 for conditional requests
        if ((etag && ifNoneMatch === etag) ||
            (lastModified && ifModifiedSince && new Date(ifModifiedSince) >= new Date(lastModified))) {
          return new Response(null, {
            status: 304,
            headers: new Headers({
              'Cache-Control': cacheControl,
              'ETag': etag,
              'Last-Modified': lastModified,
              'Content-Type': response.headers.get('Content-Type'),
              'Vary': 'Accept-Encoding'
            })
          });
        }

        // Set cache headers for normal responses
        modifiedResponse.headers.set('Cache-Control', cacheControl);
        modifiedResponse.headers.set('Expires', expires);
        modifiedResponse.headers.set('Vary', 'Accept-Encoding');

        // Add compression hint for large files
        if (contentLength > 1024 * 1024) {
          modifiedResponse.headers.set('Accept-Encoding', 'gzip, deflate, br');
        }

        if (etag) {
          modifiedResponse.headers.set('ETag', etag);
        }
        if (lastModified) {
          modifiedResponse.headers.set('Last-Modified', lastModified);
        }

        // Remove the custom header
        modifiedResponse.headers.delete('X-Cache-Info');
        return modifiedResponse;
      } catch (e) {
        console.error('Failed to parse cache info:', e);
      }
    }

    return response;
  }
};
