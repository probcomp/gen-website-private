// An Express server that serves static files from a Google Cloud Storage bucket.

// - HTML files are piped directly through the server.
// - Other files are redirected to a signed bucket url.
// - Paths without an extension are served `index.html` (to support SPAs).

// URLs are expected to be in the form `REPO.preview.gen.dev/foo` or, mainly for dev/testing,
// HOST/preview/REPO/foo.

import express from 'express';
import { Storage } from '@google-cloud/storage';
import { getMimeType } from 'stream-mime-type';

const { PORT, BUCKET_NAME } = process.env;
const MAX_AGE = 60;
const bucketPath = (repo, filePath) => `probcomp/${repo}/${filePath}`
const HOST_REPO_REGEX = /^(.+)\.preview\.gen\.dev$/

const app = express();
const storage = new Storage();
const bucket = storage.bucket(BUCKET_NAME);

const generateSignedUrl = async (file) => {
    const options = {
        version: 'v4',
        action: 'read',
        expires: Date.now() + 5 * 60 * 1000, // 5 minutes
    };
    const [url] = await file.getSignedUrl(options);
    return url;
};

const getExtension = (path) => {
    const i = path.lastIndexOf('.')
    if (i !== -1) {
        return path.substring(i+1)
    }
}

const serveHtml = async (res, path) => {
    const htmlFile = bucket.file(path);
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Cache-Control', `public, max-age=${MAX_AGE}`);
    return new Promise((resolve, reject) => {
        htmlFile.createReadStream()
            .on('error', reject)
            .pipe(res)
            .on('finish', resolve);
    });
};

const pipeFile = async (res, path) => {
    const {mime, stream} = await getMimeType(bucket.file(path).createReadStream(), {filename: path});
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', `public, max-age=${MAX_AGE}`);
    return stream.pipe(res);
}

const redirectFile = async (res, path) => {
    const signedUrl = await generateSignedUrl(bucket.file(path));
    return res.redirect(301, signedUrl);
}

const handleFileRequest = async (repo, filePath, res) => {
    const path = bucketPath(repo, filePath);
    const ext = getExtension(path);
    
    try {
        if (!ext) {
            await serveHtml(res, bucketPath(repo, "index.html"));
        }
        else if (ext == 'html') { 
            await serveHtml(res, path);
        } else {
            // two options here, pipeFile or redirectFile using a signed URL.
            // Opting for redirectFile to reduce load on the server.
            // pipeFile(res, path)
            redirectFile(res, path);
        } 
    } catch (error) {
        if (error.code === 404) {
            console.log('File not found', path);
            res.status(404).send('File not found');
        } else {
            console.error('Error fetching file:', error);
            res.status(500).send('Internal Server Error');
        }
    }
};

app.get('/preview/:repo/*', async (req, res) => {
    await handleFileRequest(req.params.repo, req.params[0] || 'index.html', res);
});

app.get('/preview/:repo', async (req, res) => {
    await handleFileRequest(req.params.repo, 'index.html', res);
});

app.get('/*', async (req, res) => {
    const host = req.hostname;
    const match = host.match(HOST_REPO_REGEX);
    if (match) {
        const repo = match[1];
        const filePath = req.params[0];
        await handleFileRequest(repo, filePath, req, res);
    } else {
        res.status(404).send('Not Found');
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
