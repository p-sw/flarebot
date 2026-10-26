# Single sign-on

Owners and Admins configure console sign-in in **Settings**. Password, passkey, TOTP, invites, and the existing session cookie keep working. Status pages stay public: `/`, `/s/:slug`, and `/api/public/*` never read `Cf-Access-Jwt-Assertion`.

Two modes can be on at the same time:

- Up to eight OpenID Connect providers (Authentik, Keycloak, Authelia, Zitadel, Okta, Microsoft Entra ID, Google, and any issuer that publishes discovery).
- One Cloudflare Access team. Access is not enabled by the old `authMode` field. `PUT /api/settings` with `authMode: "access"` returns 400 and stores nothing.

Both modes create the same `flarebot_session` cookie the password form uses (`httpOnly`, `SameSite=Lax`, 14 days, `Secure` on https). Later API requests check that session. They do not verify an identity token again.

`ENCRYPTION_KEY` must be set before you save a client secret. The secret and the short-lived PKCE verifier are encrypted with the same AES-GCM helper as SMTP passwords. The API returns `clientSecretSet` and never the secret. Migration `0007_sso.sql` adds `sso_providers`, `sso_identities`, `oidc_transactions`, and `sso_jwks_cache`. It does not rewrite users or sessions. Access policy stays in the `sso_policy` settings row.

## Who can change it

`sso.manage` is Admin and Owner. Editors and Viewers do not see the single sign-on section. Instance name, check-history retention, and mail stay Owner-only on the same page.

## OpenID Connect

Each provider is one row. The login page shows one button per enabled provider, using the button label you set. A disabled provider stays in Settings and is omitted from the login page.

The redirect URI is shown in Settings. It is `{origin}/api/auth/oidc/callback` and is the same for every provider. Copy it into the identity provider exactly, including the scheme and host.

Flarebot uses the authorization code flow with PKCE (`S256`), a `state` cookie (`flarebot_oidc`, path `/api/auth/oidc`, 10 minutes), and a `nonce`. The cookie must match the returned `state`. The transaction row stores only hashes and the encrypted verifier, and it is deleted on use. The token request sends `client_secret` in the body when a secret is saved (`client_secret_post`). A public client can leave the secret empty. HTTP Basic (`client_secret_basic`) is not sent.

ID tokens must be compact signed tokens (`RS256` or `ES256`). `none`, HMAC, and encrypted tokens (five segments) are rejected. Flarebot checks the signature against the issuer's JWKS, then checks `iss`, `aud` (and `azp` when `aud` is a list), `exp` / `nbf` / `iat` with 60 seconds of clock skew, and `nonce`.

Accounts link by verified email:

- A returning subject uses the saved link.
- Otherwise the verified email must match an existing user.
- If those two point at different users, sign-in stops.
- A new verified email is created only when **Create accounts on first sign-in** is on, with the default role, unless a role rule matched.
- `email_verified` must be true. Microsoft Entra ID may send `xms_edov` instead. `preferred_username` is accepted when it contains `@` and the verified flag is set.
- Optional allowed domains reject every other domain before linking.
- Role rules read one claim (default `groups`). The first exact, case-sensitive match wins. An existing user who matches nothing keeps their current role. A new user who matches nothing gets the default role. The last Owner is never demoted.

Discovery tries `{issuer}/.well-known/openid-configuration`, then the RFC 8414 insertion path. The document's `issuer` must match the URL you entered, ignoring one trailing slash. **Test discovery** does not save. A successful login caches the document on the provider for one hour. Changing the issuer clears that cache. Issuer, authorization, token, and JWKS URLs must be public `https` addresses. Redirects are not followed.

### Authentik

Use a second browser window so you can keep the Flarebot Settings page open.

1. In Authentik, open **Applications → Providers → Create**, and choose **OAuth2/OpenID Provider**.
2. Set the authorization flow to the implicit-consent flow if you do not want an extra consent screen, or the explicit-consent flow if you do.
3. Set **Client type** to **Confidential**.
4. Set the client authentication method to **Client secret (post)**. Flarebot posts the secret in the token body. Basic auth will fail the token request.
5. Copy the client ID and client secret.
6. Under **Redirect URIs / Origins**, add the strict redirect URI from Flarebot Settings. Do not use a wildcard.
7. Under scopes, include `openid`, `email`, and `profile`. To map groups, also include the built-in scope mapping **authentik default OAuth Mapping: OpenID 'groups'**. That mapping puts group names in the `groups` claim.
8. Leave ID-token encryption off. The signing key should be an RSA certificate so the algorithm is `RS256`.
9. Create an **Application**, link it to this provider, and note the slug.
10. Open the provider's preview and copy the **Issuer** URL. It looks like `https://auth.example.com/application/o/<application-slug>/`. Paste that into Flarebot. Do not paste the `/.well-known/openid-configuration` URL. Flarebot adds that path itself.
11. In Flarebot, **Add provider**. Set the display name (for example `Authentik`) and the button label (`Sign in with Authentik`). Paste the issuer, client ID, and client secret. Scopes: `openid email profile`, plus `groups` when you added that scope. Click **Test discovery** and confirm the issuer and the three endpoints. Save.
12. Mark the Authentik user's email as verified. Unverified addresses are rejected.
13. Open `/login` in a private window and use the new button. The first success links that Authentik subject to the Flarebot user with the same email. A later login uses the link even if the email changes at the provider, until you delete the provider (which removes links, not user accounts).

Other issuers use the same Flarebot fields. Keycloak's issuer is the realm URL (`https://keycloak.example.com/realms/example`). Entra ID's issuer is `https://login.microsoftonline.com/{tenant}/v2.0`. Google's issuer is `https://accounts.google.com`. Each must allow the same redirect URI, sign with `RS256` or `ES256`, and send a verified email. If the provider only supports Basic client authentication, create a public client and leave the Flarebot secret empty so PKCE is the only client check.

### Hide password and passkey sign-in

The policy switch hides the password and passkey form on `/login`. Invites, password reset, and `/setup` are unchanged.

Owners can still open `/login?break-glass=1`. That query only shows the form. The API allows password and passkey sign-in for the Owner role and returns 403 for every other role, whether or not the query is present. A non-owner who knows the URL still cannot sign in with a password.

Turn the switch on only after an Owner has signed in once with SSO, and keep the break-glass URL written down. If no provider is enabled while the form is hidden, Settings shows a warning. The Owner path still works.

## Cloudflare Access

When **Trust Cloudflare Access** is on, `/login` shows **Sign in with Cloudflare Access**. That button `POST`s to `/api/auth/access` on this origin. It does not redirect to Access. Cloudflare adds `Cf-Access-Jwt-Assertion` only after the browser has already passed an Access application on this hostname. If the header is missing, the API says so and does not create a session.

The header is ignored while the switch is off: Flarebot does not fetch certificates and does not set a cookie. A client that sends a forged header gets nothing. When the switch is on, the token is checked before any user lookup:

- Three segments, at most 16 KB, signature via `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`.
- `iss` is `https://<team>.cloudflareaccess.com`.
- `aud` intersects one of the application AUD tags you saved.
- `exp`, `nbf`, and `iat` use the same 60 second skew.
- `type`, when present, must be `app`.
- Email comes from the token's `email` claim, not from the identity endpoint.

The team name is one label (`myteam`) or the full host (`myteam.cloudflareaccess.com`). Other hosts are rejected, so the certificate URL cannot be pointed at an attacker.

Role rules are required. The first exact match wins. A rule can match a group, a full email, or an email domain. Someone who matches nothing is denied, including a person who already has a Flarebot account. Optional allowed domains run before the rules. **Create accounts on first sign-in** creates a user only after a rule matches, and the new role is that rule's role. Include a rule that keeps an Owner.

If the token has no groups and a rule needs groups, Flarebot calls `https://<team>.cloudflareaccess.com/cdn-cgi/access/get-identity` once with the same header. The email is still taken from the token.

### Authentik behind Cloudflare Access

This uses Authentik as the Access login method, then Flarebot as the application behind Access. It is separate from the OpenID button above. You can run both.

1. In Zero Trust, open **Settings → Team name and domain** and note the team name. The certificate host will be `<team>.cloudflareaccess.com`.
2. In Authentik, create a second OAuth2/OpenID provider (or reuse one) whose redirect URI is `https://<team>.cloudflareaccess.com/cdn-cgi/access/callback`. Use **Client secret (post)** or whatever method Access uses for this login method. Include `openid`, `email`, `profile`, and the groups scope mapping. Copy the issuer's authorization URL, token URL, and JWKS URL from discovery.
3. In Zero Trust, open **Integrations → Identity providers → Add new identity provider → OpenID Connect**. Paste the client ID, client secret, auth URL, token URL, and certificate URL. Set the email claim to `email`. Under **OIDC claims**, add `groups` so Access can forward Authentik group names. Save, then **Test** the login method.
4. Open **Access controls → Applications → Create new application → Self-hosted**. Set the public hostname to the Flarebot hostname you want people to use for the console, for example `status.example.com`. Select the Authentik login method. Add an **Allow** policy that matches the people who should reach the console (email, email domain, or the Authentik group). Copy the application's **AUD** tag from the overview.
5. In Flarebot Settings, turn on **Trust Cloudflare Access**. Team name: the value from step 1. Audience tags: the AUD tag, one per line. Group claim: `groups`. Add role rules that match the same emails or group names, and give at least one rule the Owner role. Save.
6. Visit `https://status.example.com/login`. Access should send you to Authentik first. After that, the Flarebot page loads with the Access header already on requests. Click **Sign in with Cloudflare Access**. Flarebot checks the token and opens a normal session.

### Keep status pages public

Do not put the public site behind that application. Create separate self-hosted applications only where you want a challenge. Leave these paths with no Access application, or give each path its own application with a **Bypass** policy (Include: Everyone), which is the pattern Cloudflare documents for a public callback or health path:

- `/` and `/s` (the status pages)
- `/api/public`
- `/push` (heartbeat ingest)

A domain-wide application with only an Allow policy will challenge visitors and monitors. Flarebot will not undo that at the edge.

### Owner break-glass

The Owner password and passkey still work at `/login?break-glass=1`, and the API still requires the Owner role.

If Access covers the hostname, the Owner cannot open that URL until Access lets the request through. Pick one:

- Leave a hostname with no Access application, such as the `workers.dev` hostname, and use `https://<worker>.workers.dev/login?break-glass=1` when Authentik or Access is down.
- Or add Bypass applications (Include: Everyone) for `/login`, `/api/auth/login`, `/api/auth/passkey`, `/forgot`, `/reset`, `/invite`, and `/setup`, so those routes reach Flarebot without an Access token. The password API still rejects non-owners.

Also keep an Allow policy that includes the Owner's email, so the normal Access button works when the identity provider is healthy.

Signing out of Flarebot does not sign you out of Access or Authentik. Use the provider's own logout when you need that session to end. See below.

## Sessions, logout, and audit

Logout is `POST /api/auth/logout`. It deletes the Flarebot session and clears `flarebot_session`. It does not redirect to the provider's `end_session` endpoint, because the ID token is not stored. The provider session can remain until it expires or the user signs out there. The next Flarebot login still requires a fresh code or a fresh Access token, and still passes the same checks.

Session `method` is `oidc` or `access` (password login stays `password` or `password+totp`, passkeys stay `passkey`). OpenID and Access sign-in do not prompt for Flarebot TOTP. Password login still does when TOTP is enabled. A disabled user is rejected. Failed attempts for that email are cleared after a successful SSO login, same as a successful password login.

Audit actions:

| Action                | When                                                  |
| --------------------- | ----------------------------------------------------- |
| `sso.policy.update`   | The sign-on policy is saved                           |
| `sso.provider.create` | A provider is added                                   |
| `sso.provider.update` | A provider is saved. The secret is not in the payload |
| `sso.provider.delete` | A provider and its identity links are removed         |
| `auth.oidc.login`     | An OpenID login created a session                     |
| `auth.access.login`   | An Access login created a session                     |
| `auth.sso.denied`     | A login failed after the provider responded           |
| `sso.role.sync`       | A rule changed an existing user's role                |
| `sso.role.kept`       | The last Owner was not demoted                        |

## Free plan

Verification runs once per login, not once per API request. After login, the request path is the existing session lookup.

| Step                   | Subrequests                                                               |
| ---------------------- | ------------------------------------------------------------------------- |
| OpenID, cold           | 3: discovery, token, JWKS                                                 |
| OpenID, warm           | 1: token. Discovery is cached for 1 hour. JWKS is cached for 1 hour in D1 |
| OpenID, unknown `kid`  | 2: token, plus one JWKS refresh                                           |
| Access                 | 1: certificate set, cached for 1 hour                                     |
| Access, groups missing | 2: certificates and one identity call, only if a group rule needs groups  |
| Test discovery         | 1, and only when an Owner or Admin clicks the button                      |

JWKS also sits in memory for 10 minutes. A stale D1 copy (up to 24 hours) is used only when the fetch fails. Each fetch allows 8 seconds and refuses redirects, so a login cannot spend the 50-subrequest budget on a redirect chain. At most eight keys are considered and at most four signatures are checked. One `RS256` or `ES256` verify is about 1–3 ms, inside the 10 ms CPU limit, and it does not run on later requests.

D1 writes for a login are the session row, an audit row, deletion of the one-time transaction, and sometimes a JWKS upsert or a new user, membership, and identity. That is a handful of writes against the 100,000 daily write quota. There is no new cron, no Queue, and no KV namespace.

## What this does not do

- It does not end the identity-provider session on logout.
- It does not send HTTP Basic client authentication.
- It does not accept `none`, HMAC, or encrypted ID tokens.
- It does not store more than one Access team.
- Group and email rules are exact. They are not regular expressions, and they are case-sensitive.
- OpenID role rules do not deny an existing user who matches nothing. Access rules do.
- It does not protect status pages. Protecting those paths is an Access application you add yourself, and then they are no longer public.

## Tests

`shared/sso.test.ts` covers discovery URLs, issuer matching, verified email, domains, claim checks, and Access team rules. `worker/auth/jwt.test.ts` signs an RSA token in the test and rejects `none`, a tampered payload, and the wrong `kid`. `test/sso.worker.test.ts` mocks discovery and Access certificates, checks the masked secret, links the owner, provisions a viewer, maps a group, enforces the owner-only password path, and rejects an Access token while Access is off and when the audience is wrong. A public status request that carries the header still does not start a session.
