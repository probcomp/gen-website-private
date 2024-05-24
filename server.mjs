// An Express server that serves static files from a Google Cloud Storage bucket.

// - HTML files are piped directly through the server using a readable stream.
// - Other files are redirected to a signed bucket URL for direct access.
// - Paths without an extension are served `index.html` to support Single Page Applications (SPAs).
// - Paths ending with a slash are served the `index.html` of the directory.

// URLs are expected to be in the form `REPO.gen.dev/foo` for production or,
// for development/testing, `localhost:3000/REPO/foo`.

import { Storage } from '@google-cloud/storage';
import express from 'express';
import memoizee from 'memoizee';
import path from 'path';
import { getMimeType } from 'stream-mime-type';

const { PORT, BUCKET_NAME } = process.env;
const HOST_REPO_REGEX = /^(.+)\.gen\.dev$/;
const BUCKET_PREFIX = 'probcomp'

const HTML_MAX_AGE = 60;

const app = express();
const storage = new Storage();
const bucket = storage.bucket(BUCKET_NAME);

const generateSignedUrl = memoizee(async (file) => {
    const options = {
        version: 'v4',
        action: 'read',
        expires: Date.now() + 60 * 60 * 1000, // Signed URL is valid for 60 minutes
    };
    const [url] = await file.getSignedUrl(options);
    return url;
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
    res.setHeader('Cache-Control', `public, max-age=${HTML_MAX_AGE}`);
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
    res.setHeader('Cache-Control', `public, max-age=${HTML_MAX_AGE}`);
    return stream.pipe(res);
};

const redirectFile = async (res, path) => {
    const signedUrl = await generateSignedUrl(bucket.file(path));
    return res.redirect(301, signedUrl);
};

const handleFileRequest = async (repo, filePath, res) => {
    // Handles file requests by determining the appropriate file path and serving the file.
    
    if (filePath.endsWith('/')) {
        // If the path ends with '/', serve the directory index.html
        filePath = path.join(filePath, 'index.html');
    } else if (!getExtension(filePath)) {
        // If there is no extension, serve the main repo index.html
        filePath = 'index.html';
    }

    // Construct the full path in the bucket
    const bucketPath = path.join(BUCKET_PREFIX, repo, filePath);
    console.log({repo, filePath, bucketPath})
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
    app.get('/:repo/*', async (req, res) => {
        await handleFileRequest(req.params.repo, req.params[0], res);
    });
    
    app.get('/:repo', async (req, res) => {
        await handleFileRequest(req.params.repo, '', res);
    });
}

app.get('/*', async (req, res) => {
    const host = req.hostname;
    const match = host.match(HOST_REPO_REGEX);
    if (match) {
        const repo = match[1];
        const filePath = req.params[0];
        await handleFileRequest(repo, filePath, res);
    } else {
        res.status(404).send('Not Found');
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
