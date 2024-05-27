# Gen Website (Private)

This repo contains code and workflows that enable probcomp repositories to publish private websites from GitHub Actions.

### I manage a probcomp repo. How do I use this?

Copy the `publish_website.yml` action into your repo under `.github/workflows`, or copy its contents into an existing action. Customize the `WEBSITE_DIR` to be the directory you want to publish. Decide how and when you want your website to be published (see the `on` block in `publish_website.yml` for ideas). You will probably want to add some kind of build step before the deploy job.

Your repo will be served from its own subdomain: `<REPO>.gen.dev`. Magic!

### Who can access these websites?

Members of the Google Groups `genjax-users@chi-fro.org` and `all@chi-fro.org` have access. To grant new users access, add them to one of these groups.

### How can I make my website public?

To make a website public, publish it to GitHub Pages (or another public environment) and ask tech-admin@chi-fro.org to point your subdomain (eg. `YOUR_REPO.gen.dev`) at the new site. Due to how [IAP](https://cloud.google.com/security/products/iap) works, it's not possible to manage visibility at a granular level in this service.

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

There is also a second identity pool, `gen-website-private-publishers`, which grants all probcomp repositories access to the private bucket 
within GitHub Actions.

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