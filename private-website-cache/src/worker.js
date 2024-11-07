export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const extension = url.pathname.split('.').pop();
    
    // Forward the request to the origin
    const response = await fetch(request);
    const modifiedResponse = new Response(response.body, response);
    
    // Clear any existing cache headers
    modifiedResponse.headers.delete('Pragma');
    modifiedResponse.headers.delete('Cache-Control');
    modifiedResponse.headers.delete('Expires');

    // Check if this is a redirect to a signed URL
    if (response.status === 302 && response.headers.get('Location')?.includes('storage.googleapis.com')) {
      // Signed URL redirects: private, 50 minutes
      const maxAge = 50 * 60; // 50 minutes in seconds
      modifiedResponse.headers.set('Cache-Control', `private, max-age=${maxAge}`);
      const expiresDate = new Date(Date.now() + maxAge * 1000);
      modifiedResponse.headers.set('Expires', expiresDate.toUTCString());
    } else if (extension) {
      // Files with extensions
      switch (extension.toLowerCase()) {
        case 'html':
          // HTML files: private, 60 seconds
          modifiedResponse.headers.set('Cache-Control', 'private, max-age=60');
          break;
          
        case 'css':
        case 'js':
        case 'map':
        case 'wasm':
        case 'data':
        case 'bin':    // Binary files often used with WebGL
        case 'gltf':   // 3D models
        case 'glb':    // Binary 3D models
        case 'obj':    // 3D models
        case 'mtl':    // Material files for 3D models
        case 'json':   // Often used for model/scene data
          // Static assets: private, 10 minutes
          modifiedResponse.headers.set('Cache-Control', 'private, max-age=600');
          break;
          
        default:
          // Other static assets that aren't redirects: private, short cache
          modifiedResponse.headers.set('Cache-Control', 'private, max-age=60');
      }
    } else {
      // Paths without extensions (HTML fallbacks): private, 60 seconds
      modifiedResponse.headers.set('Cache-Control', 'private, max-age=60');
    }
    
    return modifiedResponse;
  }
};