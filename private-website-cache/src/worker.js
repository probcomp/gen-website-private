export default {
  async fetch(request, env, ctx) {
    const response = await fetch(request);

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
