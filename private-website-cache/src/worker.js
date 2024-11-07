export default {
  async fetch(request, env, ctx) {
    // Add ETag and If-Modified-Since handling
    const ifNoneMatch = request.headers.get('If-None-Match');
    const ifModifiedSince = request.headers.get('If-Modified-Since');
    const response = await fetch(request);

    // Check both ETag and Last-Modified
    if ((ifNoneMatch && response.headers.get('ETag') === ifNoneMatch) ||
        (ifModifiedSince && response.headers.get('Last-Modified') === ifModifiedSince)) {
      return new Response(null, {
        status: 304,
        headers: new Headers({
          'Cache-Control': response.headers.get('Cache-Control'),
          'ETag': response.headers.get('ETag'),
          'Last-Modified': response.headers.get('Last-Modified')
        })
      });
    }

    // Check for custom cache policy
    const cachePolicyHeader = response.headers.get('X-Cache-Policy');
    if (cachePolicyHeader) {
      try {
        const policy = JSON.parse(cachePolicyHeader);
        const modifiedResponse = new Response(response.body, response);
        modifiedResponse.headers.delete('Pragma');
        modifiedResponse.headers.delete('Cache-Control');
        modifiedResponse.headers.delete('Expires');
        modifiedResponse.headers.set('Cache-Control', `${policy.visibility}, max-age=${policy.maxAge}`);
        const expiresDate = new Date(Date.now() + policy.maxAge * 1000);
        modifiedResponse.headers.set('Expires', expiresDate.toUTCString());
        return modifiedResponse;
      } catch (e) {
        console.error('Failed to parse cache policy:', e);
      }
    }

    return response;
  }
};
