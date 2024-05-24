# Static site with password auth via GAE

See `.github/workflows/release.yml`.

Authentication in the GitHub Action is performed via Workload Identity Federation, to avoid handling long-lived service account files, using this GitHub Action: https://github.com/google-github-actions/auth

I followed the instructions for [Workload Identity Federation through a Service Account](https://github.com/google-github-actions/auth?tab=readme-ov-file#workload-identity-federation-through-a-service-account), after first 
implementing the recommended "Direct Workload Identity Federation" and finding it broken due to a [2-year-old bug](https://github.com/firebase/firebase-admin-node/issues/1377).

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

To run this in a different repository, you'll need to edit the identity pool's [github provider](https://console.cloud.google.com/iam-admin/workload-identity-pools/pool/app-engine-publishers/provider/github?project=probcomp-caliban), specifically the "Attribute Conditions".

I also created an identity for publishing to the `gen-website-private` bucket called `gen-website-private-publishers`.