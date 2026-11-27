# StoryZLine

A small local web tool: enter an **eCommAPI** and the **EndPoint Java file location**, and it pulls the Java source from Bitbucket. It then shows the source with the matching endpoint method highlighted.

## Setup

1. Node.js 18 or newer (no `npm install` needed: there are no dependencies).
2. Run `npm start` (or double-click `start.cmd`) and open http://127.0.0.1:5180.
3. In the **Bitbucket login** section, enter:
   - **Bitbucket URL**: the address you open Bitbucket at (with any context path, e.g. `https://git.bank.com/bitbucket`), or `https://bitbucket.org` for Cloud.
   - **User ID** and **Password**. If your Bitbucket uses SSO or two-factor login, use an HTTP access token as the password. Bitbucket Cloud needs an API token, not your account password.
   - Optional: a default project, repo and branch, so you can type plain file paths.

   Click **Log in** to check it. The password is sent only to this local server and on to Bitbucket, and is never saved. The other fields are remembered in your browser.

Optionally you can preset the URL and defaults in a `.env` file (see `.env.example`). `.env` is git-ignored.

If your company uses its own TLS certificate authority, start Node with `NODE_EXTRA_CA_CERTS=path\to\corp-ca.pem`.

## Running on another computer

1. Install **Node.js 18 or newer** (the LTS version from https://nodejs.org/). Python is not needed.
2. Get the code: `git clone https://github.com/zhangranarz/StoryZLine.git`, or **Code > Download ZIP** on GitHub and unzip it. (Don't run `start.cmd` from inside the ZIP.)
3. Double-click `start.cmd`, or run `npm start` in the folder, and open http://127.0.0.1:5180 **on that same computer**.

If it doesn't work:
- *"Node.js is not installed"* / *"'node' is not recognized"*: install Node, then open a **new** window.
- *Window flashes and closes*: open a terminal in the folder and run `node server.js` to see the error.
- *`EADDRINUSE`*: something already uses port 5180. Run `set PORT=5181` then `start.cmd`, and open http://127.0.0.1:5181.
- *"Could not reach Bitbucket"*: that laptop can't reach the Bitbucket server. Connect to the company network/VPN and check the URL opens in its browser.
- *`UNABLE_TO_GET_ISSUER_CERT_LOCALLY`* or *`SELF_SIGNED_CERT_IN_CHAIN`*: your company's certificate authority. Run `set NODE_EXTRA_CA_CERTS=C:\path\to\corp-ca.pem` before `start.cmd`.
- The server only accepts connections from the computer it runs on. Opening `127.0.0.1:5180` on one laptop never reaches the server on another; run it on each laptop.

## What you can enter

**EndPoint Java file location**, any of:
- A Bitbucket Server URL copied from the browser: `https://git.bank.com/projects/ECOM/repos/ecomm-api/browse/src/main/java/.../PortfolioEndpoint.java?at=refs/heads/develop`
- A Bitbucket Cloud URL: `https://bitbucket.org/<workspace>/<repo>/src/<branch>/<path>`
- A plain path inside the default repo: `src/main/java/.../PortfolioEndpoint.java`

**eCommAPI**: the API path or full URL, e.g. `/spl-banking/enq/customer/portfolio/{id}`. StoryZLine finds the Spring (`@RequestMapping`, `@GetMapping`, …) and JAX-RS (`@Path`, `@GET`, …) mappings in the file. It joins class and method paths and matches them against the eCommAPI, allowing for a context-path prefix and `{path}` variables. Lines that only mention the API text are highlighted too.

## Security

- The server listens on `127.0.0.1` only. The password is held in the page's memory and passed through per request; it is never written to disk or browser storage.
- The API only accepts JSON requests from the StoryZLine page itself, so other websites open in your browser can't use it.
- A pasted file URL must be on the same host as the Bitbucket URL; others are rejected.

## Tests

`npm test`
