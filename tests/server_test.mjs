import request from 'supertest';
import {app} from '../src/server.mjs'; // import your server
import { expect } from 'chai';

const port = 3001;
const bucketPath = 'gen.dev';
const subDomain = 'local-test';

describe('Server Functionality Tests', function() {
    before(function(done) {
        this.server = app.listen(port, () => {
            console.log(`Test server running on port ${port}`);
            done();
        });
    });

    after(function(done) {
        this.server.close(() => {
            console.log('Test server closed');
            done();
        });
    });

    it('should serve index.html from the root of the subdomain', async function() {
        const response = await request(app).get(`/${bucketPath}/${subDomain}/`);
        expect(response.status).to.equal(200);
        expect(response.text).to.contain('`index.html`'); // Check for the file path
    });

    it('should serve a-directory/index.html for /a-directory', async function() {
        const response = await request(app).get(`/${bucketPath}/${subDomain}/a-directory`);
        expect(response.status).to.equal(200);
        expect(response.text).to.contain('`a-directory/index.html`'); // Check for the file path
    });

    it('should serve a-directory/index.html for /a-directory/', async function() {
        const response = await request(app).get(`/${bucketPath}/${subDomain}/a-directory/`);
        expect(response.status).to.equal(200);
        expect(response.text).to.contain('`a-directory/index.html`'); // Check for the file path
    });

    it('should serve a-directory/page.html for /a-directory/page.html', async function() {
        const response = await request(app).get(`/${bucketPath}/${subDomain}/a-directory/page.html`);
        expect(response.status).to.equal(200);
        expect(response.text).to.contain('`a-directory/page.html`'); // Check for the file path
    });

    it('should serve a-directory/page.html for /a-directory/page', async function() {
        const response = await request(app).get(`/${bucketPath}/${subDomain}/a-directory/page`);
        expect(response.status).to.equal(200);
        expect(response.text).to.contain('`a-directory/page.html`'); // Check for the file path
    });

    it('should serve a-directory/page/index.html for /a-directory/page/', async function() {
        const response = await request(app).get(`/${bucketPath}/${subDomain}/a-directory/page/`);
        expect(response.status).to.equal(200);
        expect(response.text).to.contain('`a-directory/page/index.html`'); // Check for the file path
    });

    it('should return 404 for non-existent file', async function() {
        const response = await request(app).get(`/${bucketPath}/${subDomain}/non-existent.html`);
        expect(response.status).to.equal(404);
        expect(response.text).to.equal('File not found');
    });

    it('should redirect non-html files', async function() {
        const response = await request(app).get(`/${bucketPath}/${subDomain}/some-image.png`);
        expect(response.status).to.equal(302);
        expect(response.headers.location).to.match(/^https:\/\/storage.googleapis.com\//); // Assuming redirection to Google Cloud Storage
    });
});