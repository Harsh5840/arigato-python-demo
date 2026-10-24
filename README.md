# Sakura Python dependency repair demo

Fictional Japanese storefront client for ProofPatch. **Main intentionally pins affected Requests 2.31.0. Never deploy, install or execute this baseline.** The static baseline job confirms fixture setup and affected inventory; a green baseline job does not mean the service is secure.

The separate ProofPatch server monitors `requirements.txt`, corroborates exact-version advisories with OSV, selects a published stable same-major release, and asks real Groq repair/reviewer roles to prepare a candidate. Only `requirements.txt` and `service/client.py` may change. The server raises a draft PR only after the trusted workflow and senior review pass. A human owns review and merging.

The workflow runs from main, binds evidence to exact baseline/candidate/run identities, downloads binary wheels for a policy-approved candidate, and executes the frozen business oracle in a network-isolated, read-only, unprivileged container. It validates the actual installed Requests version, OSV matches for five actual application dependencies, and 12 business assertions covering Japanese text, integer yen, authentication, URL encoding, timeouts and TLS.

`npm test` performs baseline classification without importing Requests. No exploit, real customer data, production endpoint, credential, deployment or automatic merge is included.

Artifact `proofpatch-<run_id>` contains `verification.json` plus actual runtime observations. Forum leads are unconfirmed inputs; only corroborated advisories authorize this repair profile.
