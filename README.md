# StoryZLine

A small local web tool: enter an **eCommAPI** and the **EndPoint Java file location**, and it pulls the Java source from Bitbucket. It then shows the source with the matching endpoint method highlighted.

## Setup

1. Windows: nothing to install (see *Running on another computer*). Elsewhere: Node.js 18 or newer, with no `npm install` needed.
2. Double-click `start.cmd` (or run `npm start`) and open http://127.0.0.1:5180.
3. Open the **⚙ Settings** tab and, under **Bitbucket login**, enter:
   - **Bitbucket URL**: the address you open Bitbucket at (with any context path, e.g. `https://git.bank.com/bitbucket`), or `https://bitbucket.org` for Cloud.
   - **User ID** and **Password**. If your Bitbucket uses SSO or two-factor login, use an HTTP access token as the password. Bitbucket Cloud needs an API token, not your account password.

   Click **Log in** to check it; it takes you back to the **eComm API** tab, where you pull files. The password is sent only to this local server and on to Bitbucket, and is never saved. The other fields are remembered in your browser.

With the Node.js server you can also preset the URL and defaults in a `.env` file (see `.env.example`). `.env` is git-ignored.

If your company uses its own TLS certificate authority, start Node with `NODE_EXTRA_CA_CERTS=path\to\corp-ca.pem`.

## Running on another computer

StoryZLine has three interchangeable servers, all with the same page, behaviour and security rules. `start.cmd` uses the first one the laptop can run:

| Server | Needs |
|---|---|
| `server.js` | Node.js 18+ |
| `server.py` | Python 3.7+ (standard library only, no `pip install`) |
| `server.ps1` | Windows PowerShell 5.1, built into Windows 10/11 |

1. Get the code: `git clone https://github.com/zhangranarz/StoryZLine.git`, or **Code > Download ZIP** on GitHub and unzip it. (Don't run `start.cmd` from inside the ZIP.)
2. Double-click `start.cmd`. It opens http://127.0.0.1:5180 **on that same computer**.

To start one by hand: `node server.js`, `python server.py --open` (or `py -3 server.py --open`), or `powershell -NoProfile -ExecutionPolicy Bypass -File server.ps1 -Open`.

If it doesn't work:
- *Blocked by group policy* / *"running scripts is disabled on this system"*: your company blocks that runtime. `start.cmd` tries the others first, so this means none of Node.js, Python or PowerShell scripts is allowed. Ask IT to approve one of them.
- *"Python was not found; run without arguments to install from the Microsoft Store"*: that is a Windows shortcut, not Python. Python isn't installed.
- *Window flashes and closes*: open a Command Prompt in the folder and run `start.cmd` there to see the message.
- *`EADDRINUSE`*: something already uses port 5180. Run `set PORT=5181` then `start.cmd`, and open http://127.0.0.1:5181.
- *"Tunnel connection failed: 407 Proxy Authentication Required"* (Python server): the company web proxy wants a Windows sign-in Python can't do. The Python server now connects directly when that happens (`--proxy auto`, the default), which works for an internal Bitbucket on the VPN. If it still fails: `python server.py --open --proxy direct`, or, if Bitbucket is only reachable through the proxy, `--proxy http://user:password@proxy-host:port`.
- *"Could not reach Bitbucket"*: that laptop can't reach the Bitbucket server. Connect to the company network/VPN and check the URL opens in its browser.
- *`UNABLE_TO_GET_ISSUER_CERT_LOCALLY`* or *`SELF_SIGNED_CERT_IN_CHAIN`*: your company's certificate authority. Run `set NODE_EXTRA_CA_CERTS=C:\path\to\corp-ca.pem` before `start.cmd`.
- The server only accepts connections from the computer it runs on. Opening `127.0.0.1:5180` on one laptop never reaches the server on another; run it on each laptop.

## Pick from Excel

Instead of typing locations, keep them in an Excel sheet. The first sheet needs a header row with these columns (any order; a title row above it is fine):

| Bitbucket URL | Project key | Repository | Branch | Endpoint Java file location |
|---|---|---|---|---|
| https://bitbucket.yourcompany.com | ECOM | ecomm-api | develop | src/main/java/com/yourcompany/ecomm/endpoint |

*Branch* and *Endpoint Java file location* are optional. **Download template** in the page gives you a CSV to start from.

1. In the **⚙ Settings** tab, click **Load Excel list…** and choose the `.xlsx` (or `.csv`) file. It is read in your browser only, and remembered there until you click **Forget list**. The **Bitbucket URL** is filled in from it (a dropdown if the sheet has several; **Other URL…** to type one).
2. In the **eComm API** tab, fill in the **Endpoint parts**:

   | Part | Input |
   |---|---|
   | Bitbucket URL | filled in from Settings |
   | Project key, Repository | dropdowns from the sheet, Repository narrowed by Project key; **Other…** to type a value (plain text boxes without a sheet) |
   | Path | text; the sheet's *Endpoint Java file location* values are suggested, and the first one is filled in while Path is empty |
   | File name | text |
   | File extension | text with suggestions (`.java`, `.xml`, `.properties`, `.yml`, …); added unless the file name already ends with it |

3. **Endpoint** shows the joined Bitbucket file URL and updates as you change the parts. You can edit it before pulling:
   `Bitbucket URL /projects/ Project key /repos/ Repository /browse/ Path / File name File extension`

   No branch is added, so Bitbucket uses the repository's default branch. To pull another branch, add `?at=<branch>` to the end of the Endpoint yourself.
4. Click **Pull from Bitbucket** (or press Enter).

Old `.xls` files aren't supported. In Excel, use *File > Save As > Excel Workbook (.xlsx)* or CSV.

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
