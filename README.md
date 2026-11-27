# StoryZLine

A small local web tool: enter an **eCommAPI** and the **EndPoint Java file location**, and it pulls the Java source from Bitbucket. It then shows the source with the matching endpoint method highlighted.

## Setup

1. Node.js 18 or newer (no `npm install` needed: there are no dependencies).
2. Copy `.env.example` to `.env` and fill in:
   - `BITBUCKET_BASE_URL`: your Bitbucket Server/Data Center URL (with any context path), or `https://bitbucket.org` for Cloud.
   - `BITBUCKET_TOKEN`: a read-only HTTP access token. `.env` is git-ignored; never commit it.
   - Optional: `BITBUCKET_PROJECT`, `BITBUCKET_REPO`, `BITBUCKET_BRANCH`, so you can type plain file paths.
3. Run `npm start` (or double-click `start.cmd`) and open http://127.0.0.1:5180.

If your company uses its own TLS certificate authority, start Node with `NODE_EXTRA_CA_CERTS=path\to\corp-ca.pem`.

## What you can enter

**EndPoint Java file location**, any of:
- A Bitbucket Server URL copied from the browser: `https://git.bank.com/projects/ECOM/repos/ecomm-api/browse/src/main/java/.../PortfolioEndpoint.java?at=refs/heads/develop`
- A Bitbucket Cloud URL: `https://bitbucket.org/<workspace>/<repo>/src/<branch>/<path>`
- A plain path inside the default repo: `src/main/java/.../PortfolioEndpoint.java`

**eCommAPI**: the API path or full URL, e.g. `/spl-banking/enq/customer/portfolio/{id}`. StoryZLine finds the Spring (`@RequestMapping`, `@GetMapping`, …) and JAX-RS (`@Path`, `@GET`, …) mappings in the file. It joins class and method paths and matches them against the eCommAPI, allowing for a context-path prefix and `{path}` variables. Lines that only mention the API text are highlighted too.

## Security

- The server listens on `127.0.0.1` only, and the token never reaches the browser.
- Requests go only to the host in `BITBUCKET_BASE_URL`; URLs for any other host are rejected.

## Tests

`npm test`
