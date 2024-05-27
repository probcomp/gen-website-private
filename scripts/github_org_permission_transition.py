#%%
# transition_script.py
from github import Github
import os

# Initialize GitHub instance with a classic personal access token which has 'repo' and 'org' permissions
g = Github(os.getenv('GITHUB_TOKEN_PROBCOMP_TEMP'))

org_name = "probcomp"
org = g.get_organization(org_name)
org_members = {member.login for member in org.get_members()}
repos = {repo: {'contributors': {contributor.login for contributor in repo.get_contributors()}, 
                'collaborators': {collaborator.login for collaborator in repo.get_collaborators(affiliation='direct')}} 
         for repo in org.get_repos()}

 #%% 
 
def implicit_collaborators():
    # implicit collaborators are people who have made contributions to the repo, but 
    # are not direct collaborators. We filter only to org members who currently have 
    # automatic write access.
    return {repo: repo_info['contributors'].intersection(org_members) - repo_info['collaborators'] 
                             for repo, repo_info in repos.items()}

def grant_write_access(implicit_contributors):
    for repo, contributor_login in implicit_contributors.items():
        repo.add_to_collaborators(contributor_login, permission="push")
    
def set_base_permission():
    org.edit(default_repository_permission="read")

#%%

# the result of this is in scripts/implicit_collaborators.py

{repo.full_name: contributors for repo, contributors in implicit_collaborators().items() if contributors}

#%%
# total number of implicit collaborators
sum(len(contributors) for contributors in implicit_collaborators().values())

#%%
# grant_write_access(implicit_collaborators())
#%%
# set_base_permission()
#%%


