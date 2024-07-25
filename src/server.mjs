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

const pipeFile = async (res, path) => {
    try {
        const bucketStream = default_bucket.file(path).createReadStream()
        bucketStream.on('error', (error) => handleResponseError(res, error))
        const { mime, stream } = await getMimeType(bucketStream, { filename: path });
        res.setHeader('Content-Type', mime);
        res.setHeader('Cache-Control', `private, max-age=${HTML_MAX_AGE}`);
        stream.on('error', (err) => handleResponseError(res, err));
        return stream.pipe(res);
    } catch (err) {
        handleResponseError(res, err)
    }
};

const redirectFile = async (res, path) => {
    // Redirects static asset requests to signed bucket URLs instead of piping them through 
    // this server. Signed URLs are valid for one hour, and memoized. 

    // Note: IAP (Identity Aware Proxy) adds cache-busting headers to all requests to prevent 
    // caching of private content. These headers *should* only control the redirect itself, 
    // but they cause Safari to refuse to cache the destination as well. 

    const [signedUrl, expires] = await generateSignedUrl(BUCKET_NAME, path);
    const maxAge = (expires - Date.now()) / 1000; // Calculate max-age in seconds
    res.setHeader('Expires', new Date(expires).toUTCString());
    res.setHeader('Cache-Control', `private, max-age=${maxAge}`);
    res.redirect(302, signedUrl);
};

const serveHtml = async (res, path) => {
    const htmlFile = default_bucket.file(path);
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
        // workaround for a Quarto issue, https://github.com/quarto-dev/quarto-cli/blob/bee87fb00ac2bad4edcecd1671a029b561c20b69/src/core/jupyter/widgets.ts#L120
        // the embed-amd.js script tag should have a `data-jupyter-widgets-cdn-only` attribute (https://www.evanmarie.com/content/files/notebooks/ipywidgets.html)
        res.redirect(302, `https://cdn.jsdelivr.net${req.url}`);
        return;
    }

    const fileExtension = getExtension(filePath); 
    // Paths with non-html file extensions redirect to the bucket
    try {
        if (fileExtension) {
            if (fileExtension === 'html') {
                await serveHtml(res, path.join(parentDomain, subDomain, filePath));
            } else if (fileExtension === 'css' || fileExtension === 'js' || fileExtension == "map" || req.headers['sec-fetch-dest'] == 'script') {
                await pipeFile(res, path.join(parentDomain, subDomain, filePath));
            } else {
                await redirectFile(res, path.join(parentDomain, subDomain, filePath));
            }
        } else {
            await serveHtmlWithFallbacks(res, parentDomain, subDomain, paths(filePath));
        } 
    } catch (error) {
        handleResponseError(res, error)
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