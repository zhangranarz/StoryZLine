# StoryZLine

A small local web tool for tracing an eComm API through its code. Type the **API** path and give it the locations in Bitbucket of the **Route** configuration file, the **Endpoint** and, in the **APIController** box, the **API** interface and the **Controller** next to it, the **Command** and the response **Builder**. It pulls them and follows the API: the route entries for that path, the Endpoint method(s) mapped to it, the API method(s) they call, the Controller method(s) that implement them, the Command method(s) those call, and the Builder method(s) that build the reply.

## Setup

1. Windows: nothing to install (see *Running on another computer*). Elsewhere: Node.js 18 or newer, with no `npm install` needed.
2. Double-click `start.cmd` (or run `npm start`) and open http://127.0.0.1:5180.
3. Open the **⚙ Settings** tab and, under **Bitbucket**, enter:
   - **Bitbucket URL**: the address you open Bitbucket at (with any context path, e.g. `https://git.bank.com/bitbucket`), or `https://bitbucket.org` for Cloud.
   - **User ID** and **Password**. If your Bitbucket uses SSO or two-factor login, use an HTTP access token as the password. Bitbucket Cloud needs an API token, not your account password.

   Click **Log in** to check it; it takes you back to the **eComm** tab, where you pull files. The password is sent only to this local server and on to Bitbucket, and is never saved. The other fields are remembered in your browser.

With the Node.js server you can also preset the URL and defaults in a `.env` file (see `.env.example`). `.env` is git-ignored.

If your company uses its own TLS certificate authority, start Node with `NODE_EXTRA_CA_CERTS=path\to\corp-ca.pem`.

## Try it without Bitbucket

`samples/` holds a demo Endpoint, API interface and Controller (plus a JAX-RS example) and `tools/mock_bitbucket.py`, a pretend Bitbucket that serves them (Python only). See [samples/README.md](samples/README.md) for the steps.

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

Instead of typing Bitbucket details, keep them in an Excel sheet. The first sheet needs a header row with these columns (any order; a title row above it is fine; other columns such as Branch are ignored):

| Bitbucket URL | Project key | Repository |
|---|---|---|
| https://bitbucket.yourcompany.com | ECOM | ecomm-api |
| | | ecomm-batch |
| | PAY | pay-api |

One row per repository. An empty **Bitbucket URL** or **Project key** cell means "same as the row above", so you only need to write them once (merged cells work too). **Download** in Settings gives you a template CSV to start from.

1. In the **⚙ Settings** tab, click **Load** and choose the `.xlsx` (or `.csv`) file. It is read in your browser only, and remembered there until you click **Forget**. The **Bitbucket URL** is filled in from it (a dropdown if the sheet has several; **Other URL…** to type one).
2. In the **eComm** tab, type the **API** path and fill in the **Endpoint**, **Route**, **APIController**, **Command**, **Validator** and **Builder** boxes. All have URL, Project, Repository and Path; the Endpoint, Route, Command, Validator and Builder boxes have one **File** + Extension (`.xml` by default for Route), the APIController box has a row each for **API File** and **Controller File** (with their Extension), in the same folder:

   | Part | Input |
   |---|---|
   | URL | the Bitbucket URL, filled in from Settings |
   | Project, Repository | dropdowns from the sheet, Repository narrowed by Project; **Other…** to type a value (plain text boxes without a sheet) |
   | Path | text |
   | File / API File / Controller File | the file name, text |
   | Extension | dropdown: `.java` (default; `.xml` for Route), `.xml`, `.properties`, `.yml`, `.yaml`, `.json`, `.sql`, `.wsdl`, `.xsd`, `.kt`, `.groovy`, `.gradle`, `.jsp`, `.txt`, *(no extension)*, or **Other…** to type one; added unless File already ends with it |

3. Each file's joined Bitbucket URL updates as you change the parts: under the line of the one-file boxes, and at the end of each file's row (API File, Controller File) in the APIController box. You can edit it before pulling:
   `URL /projects/ Project /repos/ Repository /browse/ Path / File Extension`

   No branch is added, so Bitbucket uses the repository's default branch. To pull another branch, add `?at=<branch>` to the end yourself. A file with no name is skipped.
4. Click **Pull from Bitbucket** (or press Enter).

Old `.xls` files aren't supported. In Excel, use *File > Save As > Excel Workbook (.xlsx)* or CSV.

## What you can enter

Each box's file URL (built from its parts, or typed/pasted) can be any of:
- A Bitbucket Server URL copied from the browser: `https://git.bank.com/projects/ECOM/repos/ecomm-api/browse/src/main/java/.../PortfolioEndpoint.java?at=refs/heads/develop`
- A Bitbucket Cloud URL: `https://bitbucket.org/<workspace>/<repo>/src/<branch>/<path>`
- A plain path inside that box's Project and Repository: `src/main/java/.../PortfolioEndpoint.java`

## How the API path, Endpoint, Route, API, Controller, Command, Validator and Builder are matched

- **Endpoint → Route**: once the Endpoint method is found (e.g. `processSubmitApi()`), the route file is searched for `_processSubmitApi` as a whole name, normally in a Camel `<from uri="direct:xx.xx_processSubmitApi"/>`. The `<route id="…">` element around it is that method's route: its id is shown in the Flow table's Route column and in the diagram, and the Route pane shows only that `<route>…</route>` section for the selected row. XML comments are ignored.
- **Fallback, API path → Route**: if no route matches by method name, the route file is searched as text (XML, properties, YAML, …). Lines holding a path pattern that matches the API path are shown: `{var}` and `*` match one segment, `**` any number, and a context path like `/spl-banking` may be on either side. If none match, lines containing at least three consecutive segments of the API path; with no API path, lines naming the Endpoint class. The Route pane then shows those lines with two lines of context, the same for every row.
- **API path → Endpoint**: the API path or full URL, e.g. `/spl-banking/enq/customer/portfolio/12345`, is matched against the Endpoint's Spring (`@RequestMapping`, `@GetMapping`, …) and JAX-RS (`@Path`, `@GET`, …) mappings, with class and method paths joined. A context-path prefix (`/spl-banking`), `{path}` variables and a query string are allowed for. Each matching Endpoint method is one row, marked **Exact match** or **Matches end of API**. With no API path, every mapping in the Endpoint is a row.
- **Endpoint → API, Controller**: the method with the Endpoint method's own name: for `processSubmitApi()`, the `processSubmitApi` method of the API file and of the Controller file, and only that method's section is shown (*(same name)* in the Flow table). In a file without a method of that name, the calls inside the Endpoint method are followed instead: calls on a field, parameter or variable whose type is the API interface or the Controller class (e.g. `portfolioApi.savePortfolio(…)`), each looked up by name in the API file and in the Controller file. If the Endpoint has no such field, calls to any method those files have. One Endpoint method can lead to several API and Controller methods.
- **Controller → Command**: the same, one step further: calls inside those Controller methods on a field or variable of the Command's class (e.g. `command.enquire(…)`, or `new PortfolioCommand(…).execute()`), looked up in the Command file. Without a Controller file, the Endpoint method's calls are used.
- **Endpoint, Controller → Validator, Builder**: calls from the Endpoint method and those Controller methods into the Validator class and into the (response) Builder class, through a field, `new …()`, or a static call such as `PortfolioResponseBuilder.portfolio(…)`. Static calls count at every step.

After **Pull from Bitbucket**, the **Process** diagram draws the whole flow for the API in one picture: a lane per layer (Request, Endpoint, Route, API, Controller, Command, Validator, Builder; only for the files pulled), a box per method or route entry, and an arrow per call found (hover for the call, e.g. `portfolioApi.savePortfolio()`). The request reads as one chain: Request → Endpoint → its Route → API → Controller → Command. When the Endpoint method has a route, its calls onward are drawn from the Route box (hover to see the Endpoint method they are in). Dotted arrows mean "implemented by" (API → Controller); dashed arrows go to the Builder, which builds the response. The selected row's path is highlighted; click a box to select its row and jump to its code.

Below it, the **Flow** table lists the rows (HTTP, Path, Match, Endpoint, Route, API, Controller, Command, Validator, Builder). Click a row (or use the arrow keys) to show its methods in the code panes below: each pane shows only the matching method(s), from the comments and annotations above down to the closing `}`, with the declarations and the Endpoint's calls highlighted. **Show whole file** switches a pane to the complete file; **Copy** copies what the pane shows. If no mapping matches the API path, the whole Endpoint file is shown.

## Security

- The server listens on `127.0.0.1` only. The password is held in the page's memory and passed through per request; it is never written to disk or browser storage.
- The API only accepts JSON requests from the StoryZLine page itself, so other websites open in your browser can't use it.
- A pasted file URL must be on the same host as the Bitbucket URL; others are rejected.

## Tests

`npm test`
