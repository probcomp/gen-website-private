// An Express server that serves static files from a Google Cloud Storage bucket.

// - HTML files are piped from the bucket.
// - Other static files are redirected to a signed bucket URL.
// - Paths without an extension are served `index.html` to support Single Page Applications (SPAs).
// - Paths ending with a slash are served the `index.html` of the directory.

// In prod, we map `subdomain.parent.com` to `parent.com/subdomain` in the bucket.
// In development, we map `localhost:3000/parent.com/subdomain` to `parent.com/subdomain` in the bucket.

import { Storage } from '@google-cloud/storage';
import express from 'express';
import memoizee from 'memoizee';
import path from 'path';
import { getMimeType } from 'stream-mime-type';

const { PORT, BUCKET_NAME } = process.env;

const HTML_MAX_AGE = 60;

const app = express();
const storage = new Storage();
const bucket = storage.bucket(BUCKET_NAME);

const generateSignedUrl = memoizee(async (bucketPath) => {
    const options = {
        version: 'v4',
        action: 'read',
        expires: Date.now() + 60 * 60 * 1000, // Signed URL is valid for 60 minutes
    };
    const [url] = await bucket.file(bucketPath).getSignedUrl(options);
    return [url, options.expires];
}, { maxAge: 50 * 60 * 1000 }); // Cache for 50 minutes

const getExtension = (path) => {
    const i = path.lastIndexOf('.');
    if (i !== -1) {
        return path.substring(i + 1);
    }
};

const serveHtml = async (res, path) => {
    const htmlFile = bucket.file(path);
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Cache-Control', `private, max-age=${HTML_MAX_AGE}`);
    return new Promise((resolve, reject) => {
        htmlFile.createReadStream()
            .on('error', reject)
            .pipe(res)
            .on('finish', resolve);
    });
};

const pipeFile = async (res, path) => {
    const { mime, stream } = await getMimeType(bucket.file(path).createReadStream(), { filename: path });
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', `private, max-age=${HTML_MAX_AGE}`);
    return stream.pipe(res);
};

const redirectFile = async (res, path) => {
    // Redirects static asset requests to signed bucket URLs instead of piping them through 
    // this server. Signed URLs are valid for one hour, and memoized. 

    // Note: IAP (Identity Aware Proxy) adds cache-busting headers to all requests to prevent 
    // caching of private content. These headers *should* only control the redirect itself, 
    // but they cause Safari to refuse to cache the destination as well. 

    const [signedUrl, expires] = await generateSignedUrl(path);
    const maxAge = (expires - Date.now()) / 1000; // Calculate max-age in seconds
    res.setHeader('Expires', new Date(expires).toUTCString());
    res.setHeader('Cache-Control', `private, max-age=${maxAge}`);
    return res.redirect(302, signedUrl); 
};

const handleFileRequest = async (parentDomain, subDomain, filePath, res) => {
    // Handles file requests by determining the appropriate file path and serving the file.
    
    if (filePath.endsWith('/')) {
        // If the path ends with '/', serve the directory index.html
        filePath = path.join(filePath, 'index.html');
    } else if (!getExtension(filePath)) {
        // If there is no extension, serve the subdomain's index.html
        filePath = 'index.html';
    }

    // Construct the full path in the bucket
    const bucketPath = path.join(parentDomain, subDomain, filePath);
    try {
        // Serve HTML files directly, otherwise redirect to a signed URL
        if (filePath.endsWith('.html')) {
            await serveHtml(res, bucketPath);
        } else {
            await redirectFile(res, bucketPath);
        }
    } catch (error) {
        // Handle errors, specifically 404 for file not found
        if (error.code === 404) {
            console.log('File not found', bucketPath);
            res.status(404).send('File not found');
        } else {
            console.error('Error fetching file:', error);
            res.status(500).send('Internal Server Error');
        }
    }
};

if (process.env.ENV == 'dev') {
    app.get('/:parentDomain/:subDomain/*', async (req, res) => {
        await handleFileRequest(req.params.parentDomain, req.params.subDomain, req.params[0], res);
    });
    
    app.get('/:parentDomain/:subDomain', async (req, res) => {
        await handleFileRequest(req.params.parentDomain, req.params.subDomain, '', res);
    });
}

app.get('/*', async (req, res) => {
    const host = req.hostname;
    const hostParts = host.split('.');
    if (hostParts.length >= 3) {
        const subDomain = hostParts[0];
        const parentDomain = hostParts.slice(1).join('.');
        const filePath = req.params[0];
        await handleFileRequest(parentDomain, subDomain, filePath, res);
    } else {
        res.status(404).send('Not Found');
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
