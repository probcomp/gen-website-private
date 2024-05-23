# Static site with password auth via GAE

Authentication in the GitHub Action is performed via Workload Identity Federation, to avoid handling long-lived service account files.

Initial setup was performed as follows:

1. I created a [Workload Identity Pool](https://cloud.google.com/iam/docs/manage-workload-identity-pools-providers) called `app-engine-publishers` in the `probcomp-caliban` GCP project.
2. I added a GitHub OIDC provider.
    - Issuer (URL): https://token.actions.githubusercontent.com
    - Attribute mapping:
        - Google 1: `google.subject`
        - OIDC 1: `assertion.sub`
        - Google 2: `attribute.repository`
        - OIDC 2: `assertion.repository`
    - Attribute Conditions
        `assertion.repository.startsWith("probcomp/")`    
        
3. In IAM, I added an entry for the following principal with an `App Engine Deployer` role.
    ```
    principalSet://iam.googleapis.com/projects/110275315150/locations/global/workloadIdentityPools/app-engine-publishers/attribute.repository/probcomp/REPO_NAME
    ```
To use in another repo, create an additional IAM entry, modifying the principal above with your desired repository name.


