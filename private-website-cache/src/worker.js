export default {
  async fetch(request, env, ctx) {
    const response = await fetch(request);

    // Check for custom cache info
    const cacheInfoHeader = response.headers.get('X-Cache-Info');
    if (cacheInfoHeader) {
      try {
        const cacheInfo = JSON.parse(cacheInfoHeader);
        const modifiedResponse = new Response(response.body, response);

        // Clear any existing cache headers that might have been set by IAP
        modifiedResponse.headers.delete('Pragma');
        modifiedResponse.headers.delete('Cache-Control');
        modifiedResponse.headers.delete('Expires');
        modifiedResponse.headers.delete('ETag');
        modifiedResponse.headers.delete('Last-Modified');

        // Restore cache control headers
        const { policy, expires, etag, lastModified } = cacheInfo;
        modifiedResponse.headers.set(
          'Cache-Control',
          `${policy.visibility}, max-age=${policy.maxAge}, stale-while-revalidate=${policy.staleWhileRevalidate}`
        );
        modifiedResponse.headers.set('Expires', expires);

        // Restore validation headers
        if (etag) {
          modifiedResponse.headers.set('ETag', etag);
        }
        if (lastModified) {
          modifiedResponse.headers.set('Last-Modified', lastModified);
        }

        // Handle conditional requests
        const ifNoneMatch = request.headers.get('If-None-Match');
        const ifModifiedSince = request.headers.get('If-Modified-Since');

        if ((ifNoneMatch && etag === ifNoneMatch) ||
            (ifModifiedSince && lastModified === ifModifiedSince)) {
          return new Response(null, {
            status: 304,
            headers: new Headers({
              'Cache-Control': modifiedResponse.headers.get('Cache-Control'),
              'ETag': etag,
              'Last-Modified': lastModified
            })
          });
        }

        return modifiedResponse;
      } catch (e) {
        console.error('Failed to parse cache info:', e);
      }
    }

    return response;
  }
};
