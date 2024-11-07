// An Express server that serves static files from a Google Cloud Storage bucket.

// - HTML files are piped from the bucket.
// - Other static files are redirected to a signed bucket URL.
// - Paths without an extension:
//   - first we check for an index.html at /path/index.html,
//   - backoff to the root `index.html` for that subdomain

// In prod, we map `subdomain.parent.com` to `parent.com/subdomain` in the bucket.
// In development, we map `localhost:3000/parent.com/subdomain` to `parent.com/subdomain` in the bucket.

import { Storage } from '@google-cloud/storage';
import express from 'express';
import memoizee from 'memoizee';
import path from 'path';
import * as assert from 'assert'

const { BUCKET_NAME } = process.env;

export const app = express();
const storage = new Storage();
const default_bucket = storage.bucket(BUCKET_NAME);

const generateSignedUrl = memoizee(async (bucketName, bucketPath) => {
    const options = {
        version: 'v4',
        action: 'read',
        expires: Date.now() + 60 * 60 * 1000, // Signed URL is valid for 60 minutes
    };
    const [url] = await storage.bucket(bucketName).file(bucketPath).getSignedUrl(options);
    return [url, options.expires];
}, { maxAge: 50 * 60 * 1000 }); // Cache for 50 minutes

const getExtension = (path) => {
    const i = path.lastIndexOf('.');
    if (i !== -1) {
        return path.substring(i + 1);
    }
};

const handleResponseError = (res, error) => {
    if (error.code == '404') {
        res.status(404).send('File not found');
    } else {
        res.status(500).send('Internal Server Error');
    }
}

const setCacheHeaders = (res, metadata = {}) => {
    const fileInfo = {
        etag: metadata.etag,
        lastModified: metadata.updated,
    };
    
    res.setHeader('X-File-Info', JSON.stringify(fileInfo));
    
    // Set basic headers for local development
    if (metadata.etag) {
        res.setHeader('ETag', metadata.etag);
    }
    if (metadata.updated) {
        res.setHeader('Last-Modified', metadata.updated);
    }
};

const serveFile = async (res, path) => {
    try {
        const file = default_bucket.file(path);
        const [metadata] = await file.getMetadata();
        
        setCacheHeaders(res, metadata);
        res.setHeader('Content-Type', metadata.contentType);
        res.setHeader('Content-Length', metadata.size);
        
        const stream = file.createReadStream();
        
        return stream.pipe(res);
    } catch (err) {
        handleResponseError(res, err);
    }
};

const serveHtml = async (res, path) => {
    try {
        const htmlFile = default_bucket.file(path);
        const [metadata] = await htmlFile.getMetadata();
        
        setCacheHeaders(res, metadata);
        res.setHeader('Content-Type', 'text/html');
        
        return new Promise((resolve, reject) => {
            let rejectLogged = (err) => {
                reject(err)
            }
            htmlFile.createReadStream()
                .on('error', rejectLogged)
                .pipe(res)
                .on('finish', resolve);
        });
    } catch (err) {
        throw err;
    }
};

/**
 * Generates a list of potential file paths based on the given file path.
 * The function considers different scenarios such as root, directory, and page paths,
 * and provides fallbacks to ensure a valid file path is returned.
 *
 * @param {string} filePath - The input file path to generate potential paths for.
 * @returns {string[]} An array of potential file paths.
 */
const paths = (filePath) => {
    const results = [];

    if (filePath === "" || filePath === "/") {
        // Root path scenario
        results.push("index.html");
    } else if (filePath.endsWith('/')) {
        // Directory path scenario with fallback
        results.push(`${filePath}index.html`);
        results.push("index.html");
    } else {
        // Page path scenario with fallback to directory and root
        results.push(`${filePath}.html`);
        results.push(`redirect:/${filePath}/`);
        // results.push("index.html");
        // enable this for SPAs
    }

    return results;
};

function testPaths() {
    assert.deepStrictEqual(paths("foo"), ['foo.html', 'redirect:foo/', 'index.html']);
    assert.deepStrictEqual(paths("foo/"), ['foo/index.html', 'index.html']);
    assert.deepStrictEqual(paths("/"), ['index.html']);
    assert.deepStrictEqual(paths(""), ['index.html']);
    console.log("All tests passed!");
}

// testPaths()

const serveHtmlWithFallbacks = async (res, parentDomain, subDomain, filePaths) => {
    for (let filePath of filePaths) {
        if (filePath.startsWith('redirect:')) {
            filePath = process.env.ENV == 'dev' ?
                path.join('/', parentDomain, subDomain, filePath.slice(9)) :
                path.join('/', filePath.slice(9))
            res.redirect(302, filePath);
            return;
        }
        const fullPath = path.join(parentDomain, subDomain, filePath);
        try {
            await serveHtml(res, fullPath);
            return; // If serveHtml succeeds, exit the function
        } catch (err) {
            if (err.code !== 404) {
                throw err; // If the error is not a 404, rethrow it
            }
        }
    }
    res.status(404).send('File not found');
};

const handleRequest = async (parentDomain, subDomain, filePath, req, res) => {
    if (req.url.startsWith("/npm/")) {
        // ... existing npm redirect code ...
    }

    const fileExtension = getExtension(filePath);
    try {
        if (fileExtension) {
            if (fileExtension === 'html') {
                await serveHtml(res, path.join(parentDomain, subDomain, filePath));
            } else {
                await serveFile(res, path.join(parentDomain, subDomain, filePath));
            }
        } else {
            await serveHtmlWithFallbacks(res, parentDomain, subDomain, paths(filePath));
        }
    } catch (error) {
        handleResponseError(res, error);
    }
};

// Add this new route handler
app.get('/bucket/:bucketName/*', async (req, res) => {
    const { bucketName } = req.params;
    const filePath = req.params[0];

    try {
        const [signedUrl, expires] = await generateSignedUrl(bucketName, filePath);
        const maxAge = (expires - Date.now()) / 1000; // Calculate max-age in seconds
        res.setHeader('Expires', new Date(expires).toUTCString());
        res.setHeader('Cache-Control', `private, max-age=${maxAge}`);
        res.redirect(302, signedUrl);
    } catch (error) {
        console.error(`Error generating signed URL for ${bucketName}/${filePath}:`, error);
        res.status(500).send('Internal Server Error');
    }
});

if (process.env.ENV == 'dev') {
    app.get('/:parentDomain/:subDomain/*', async (req, res) => {
        await handleRequest(req.params.parentDomain, req.params.subDomain, req.params[0], req, res);
    });

    app.get('/:parentDomain/:subDomain', async (req, res) => {
        await handleRequest(req.params.parentDomain, req.params.subDomain, '', req, res);
    });
}

app.get('/*', async (req, res) => {
    const host = req.hostname;
    const hostParts = host.split('.');
    if (hostParts.length >= 3) {
        const subDomain = hostParts[0];
        const parentDomain = hostParts.slice(1).join('.');
        const filePath = req.params[0];
        await handleRequest(parentDomain, subDomain, filePath, req, res);

    } else {
        res.status(404).send('File not found');
    }
});

export const serve = (PORT) => {
    app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
    });
}