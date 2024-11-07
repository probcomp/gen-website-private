# Gen Website (Private)

This repo contains code and workflows that enable probcomp repositories to publish private websites from GitHub Actions.

### I manage a probcomp repo. How do I use this?

Create a GitHub action which builds your repo's website, and then follow the example in `.github/workflows/publish_private_website_example.yml`. You'll need to create an artifact containing your website files (at the end of your job where you build the site), and then pass that artifact's name to the action `probcomp/gen-website-private/.github/workflows/publish_private_website.yml@main`. The action requires `id-token: write` permissions.

Your repo will be served from its own subdomain: `<REPO>.gen.dev`.

### Who can access these websites?

Members of the Google Groups `genjax-users@chi-fro.org` and `all@chi-fro.org` have access. To grant new users access, add them to one of these groups.

### How can I make my website public?

To make a website public, publish it to GitHub Pages (or another public environment) and ask tech-admin@chi-fro.org to point your subdomain (eg. `YOUR_REPO.gen.dev`) at the new site. There is a GitHub Action called "Set CNAME Record for gen.dev" for this purpose. 

(Due to how [IAP](https://cloud.google.com/security/products/iap) works, it's not possible to manage visibility at a granular level in the app engine instance that manages private websites.)

## Admin / Implementation Notes 

Private websites are served by a single App Engine (Standard Environment) instance. Access to the website is controlled via [Identity-Aware Proxy](https://console.cloud.google.com/security/iap?referrer=search&project=probcomp-caliban). 

To grant access to new users, add them to one of the Google Groups that has access. To grant access to new groups, add the `IAP-secured Web App User` role to an IAM principal.


### Authentication Notes

Access to Google Cloud services is managed via 
[Workload Identity Federation through a Service Account](https://github.com/google-github-actions/auth?tab=readme-ov-file#workload-identity-federation-through-a-service-account)
using the [google-github](https://github.com/google-github-actions/auth) action. This avoids managing secrets.

We will now find in our GCP account:

1. A [Workload Identity Pool](https://cloud.google.com/iam/docs/manage-workload-identity-pools-providers) called `app-engine-publishers`, containing...
2. A GitHub OIDC provider, configured with:
    - Issuer (URL): https://token.actions.githubusercontent.com
    - Attribute mappings:
        - `google.subject` -`assertion.sub`
        - `attribute.repository` - `assertion.repository`
        - `attribute.repository_owner` - `assertion.repository_owner`
    - Attribute Conditions:
        `assertion.repository_owner == 'probcomp' && assertion.repository == 'probcomp/gen-website-private'`    
3. A `github-appengine-deploy` service account, with the roles:
    - App Engine Deployer
    - App Engine Service Admin
    - Cloud Build Service Account
    - Workload Identity User
4. When the service account is added to the identity pool, it also has an attribute mapping specified to restrict usage.
    - `attribute.repository` - `probcomp/gen-website-private`

There is also a second identity pool, `gen-website-private-publishers`, which grants all probcomp repositories access to the private bucket within GitHub Actions.

Using this identity pool, a GitHub action in any probcomp website can modify the `gen-website-private` bucket without restriction.

To enable App Engine to create signed blobs (time-limited links to files in the private bucket), I added the required permission via the following command (using the console UI didn't work, [this](https://stackoverflow.com/a/76493825) helped):
  ```
  gcloud projects add-iam-policy-binding probcomp-caliban --member=serviceAccount:probcomp-caliban@appspot.gserviceaccount.com --role='roles/iam.serviceAccountTokenCreator'
  ```

### SSL / Custom Domains

To publish to `www.gen.dev`, set `SUBDOMAIN` to `www`. To publish to a `PARENT_DOMAIN` other than `gen.dev`, an additional custom domain must be added via App Engine in Google Cloud.

[These instructions](https://gist.github.com/patmigliaccio/d559035e1aa7808705f689b20d7b3fd3) were essential to enabling SSL for a wildcard 
subdomain on App Engine.  I created an origin certificate in Cloudflare, appended the [Cloudflare Origin CA root certificate (ECC PEM)](https://developers.cloudflare.com/ssl/origin-configuration/origin-ca#cloudflare-origin-ca-root-certificate) to the PEM file, and converted the private key to RSA using the following command ([note](https://gist.github.com/patmigliaccio/d559035e1aa7808705f689b20d7b3fd3?permalink_comment_id=4421351#gistcomment-4421351) the `-traditional` flag):
```sh
openssl rsa -in domain.com-YYYY-MM-dd.key -out domain.com-RSA-YYYY-MM-dd.key -traditional
```
The certificate was free and expires in 15 years; it's only useful for use between Cloudflare and App Engine. (If we would switch DNS providers we would need another wildcard subdomain SSL solution.)

### Accessing Files from Other Buckets

This server now supports accessing files from any Google Cloud Storage bucket that grants read access to the `gen-website-private-admin@probcomp-caliban.iam.gserviceaccount.com` service account. You can access these files using the following URL pattern:

```
https://probcomp-caliban.uc.r.appspot.com/bucket/<BUCKET_NAME>/<FILE_PATH>
```

Note that we currently use signed urls for bucket redirects, which do not respect the CORS policy of the bucket.

### CORS

As buckets are private, we redirect using time-limited signed urls, which do not follow the CORS policy of the bucket. ~CORS support is handled by `cors-config.json` which was added to the bucket via `gsutil cors set cors-config.json gs://gen-website-private` ([details](https://stackoverflow.com/questions/45273514/google-cloud-storage-gcs-cors-wildcard))~ 

## Developer notes 

### Cloudflare Worker

A cloudflare worker (`./private-website-cache/src/worker.js`) sits in front of `*.gen.dev` to apply caching policies, which are otherwise ignored/overwritten by IAP (Identity Aware Proxy). These can be modified by:
- editing `worker.js`
- making sure you have access to our Cloudflare group
- `npx wrangler login` and `npx deploy` from within the `private-website-cache` directory

### Caching Policies

The Cloudflare worker implements three tiers of caching:

1. HTML files:
   - Private cache (per-user)
   - 60 second max age
   - 30 second stale-while-revalidate window

2. Static assets (default):
   - Public cache
   - 24 hour max age 
   - 1 hour stale-while-revalidate window

3. Large binary files (.wasm, .data):
   - Public cache
   - 1 year max age
   - Immutable (no revalidation)
   - Uses Cloudflare Cache API for improved performance

The worker strips standard caching headers from the origin and applies these policies consistently. It also preserves ETags and Last-Modified dates when available, and sets Vary: Accept-Encoding for proper handling of compressed content.
