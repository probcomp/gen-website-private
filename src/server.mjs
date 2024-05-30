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
import { getMimeType } from 'stream-mime-type';
import * as assert from 'assert'

const { BUCKET_NAME } = process.env;

const HTML_MAX_AGE = 60;

export const app = express();
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
    res.redirect(302, signedUrl);
};

const serveHtml = async (res, path) => {
    const htmlFile = bucket.file(path);
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Cache-Control', `private, max-age=${HTML_MAX_AGE}`);
    return new Promise((resolve, reject) => {
        let rejectLogged = (err) => {
            reject(err)
        }
        htmlFile.createReadStream()
            .on('error', rejectLogged)
            .pipe(res)
            .on('finish', resolve);
    });
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
        results.push(`${filePath}/index.html`);
        results.push("index.html");
    }
    
    return results;
};

function testPaths() {
    assert.deepStrictEqual(paths("foo"), ['foo.html', 'foo/index.html', 'index.html']);
    assert.deepStrictEqual(paths("foo/"), ['foo/index.html', 'index.html']);
    assert.deepStrictEqual(paths("/"), ['index.html']);
    assert.deepStrictEqual(paths(""), ['index.html']);
    console.log("All tests passed!");
}

// testPaths()

const serveHtmlWithFallbacks = async (res, parentDomain, subDomain, filePaths) => {
    for (const filePath of filePaths) {
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

const handleFileRequest = async (parentDomain, subDomain, filePath, res) => {
    const fileExtension = getExtension(filePath);
    // Paths with non-html file extensions redirect to the bucket
    try { 
        if (fileExtension) {
            if (fileExtension == 'html') {
                await serveHtml(res, path.join(parentDomain, subDomain, filePath));
            } else {
                await redirectFile(res, path.join(parentDomain, subDomain, filePath));
            }
        } else {
            await serveHtmlWithFallbacks(res, parentDomain, subDomain, paths(filePath));
        }
    } catch (error) {
        if (error.code === 404) {
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

export const serve = (PORT) => {
    app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
    });    
}
