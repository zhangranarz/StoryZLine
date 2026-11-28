# StoryZLine

A small local web tool for tracing an eComm API through its code. Type the **API** path and give it the locations in Bitbucket of the **Route** configuration file, the **Endpoint** and, in the **APIController** box, the **API** interface and the **Controller** next to it, and the **Command**. It pulls them and follows the API: the route entries for that path, the Endpoint method(s) mapped to it, the API method(s) they call, the Controller method(s) that implement them, and the Command method(s) those call.

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
2. In the **eComm** tab, type the **API** path and fill in the **Endpoint**, **Route**, **APIController** and **Command** boxes. All have URL, Project and Repository. The Endpoint and Command boxes have one Path and one **File** + Extension; the APIController box has one Path and a row each for **API File** and **Controller File** (with their Extension), in the same folder; the Route box has a row each for **Endpoint File** and **Reference File**, each with its own **Path**, File and Extension (`.xml` by default):

   | Part | Input |
   |---|---|
   | URL | the Bitbucket URL, filled in from Settings |
   | Project, Repository | dropdowns from the sheet, Repository narrowed by Project; **Other…** to type a value (plain text boxes without a sheet) |
   | Path | text |
   | File / API File / Controller File | the file name, text |
   | Extension | dropdown: `.java` (default; `.xml` for Route), `.xml`, `.properties`, `.yml`, `.yaml`, `.json`, `.sql`, `.wsdl`, `.xsd`, `.kt`, `.groovy`, `.gradle`, `.jsp`, `.txt`, *(no extension)*, or **Other…** to type one; added unless File already ends with it |

3. Each file's joined Bitbucket URL updates as you change the parts: under the line of the one-file boxes, and at the end of each file's row (API File, Controller File) in the APIController box. You can edit it before pulling:
   `URL /projects/ Project /repos/ Repository /browse/ Path / File Extension`

   The **Command** box can stay empty when the Controller method carries `@CommandHandler(command = "…")`: the Command file is then found and pulled by itself, and the box is filled in with it (see below).

   No branch is added, so Bitbucket uses the repository's default branch. To pull another branch, add `?at=<branch>` to the end yourself. A file with no name is skipped.
4. Click **Pull from Bitbucket** (or press Enter).

Old `.xls` files aren't supported. In Excel, use *File > Save As > Excel Workbook (.xlsx)* or CSV.

## What you can enter

Each box's file URL (built from its parts, or typed/pasted) can be any of:
- A Bitbucket Server URL copied from the browser: `https://git.bank.com/projects/ECOM/repos/ecomm-api/browse/src/main/java/.../PortfolioEndpoint.java?at=refs/heads/develop`
- A Bitbucket Cloud URL: `https://bitbucket.org/<workspace>/<repo>/src/<branch>/<path>`
- A plain path inside that box's Project and Repository: `src/main/java/.../PortfolioEndpoint.java`

## How the API path, Endpoint, Route, API, Controller and Command are matched

- **Endpoint → Route**: once the Endpoint method is found (e.g. `processSubmitApi()`), the route file is searched for `_processSubmitApi` as a whole name, normally in a Camel `<from uri="direct:xx.xx_processSubmitApi"/>`. The `<route id="…">` element around it is that method's route: its id is shown in the Flow table's Route column and in the diagram, and the Route pane shows only that `<route>…</route>` section for the selected row. XML comments are ignored.
- **Several Route files**: put `*` in the **Endpoint File**, e.g. `payment*` (Extension `.xml`). On **Pull from Bitbucket** the folder in Path is listed through Bitbucket's REST API (all pages; Bitbucket Server and Cloud), and every file whose name fits is pulled: `payment.xml`, `payment-v-1.1.xml`, `payment-spl-1.1.xml`, … (`*` stands for any characters; case is not minded; at most 50 files). The route search runs in each of them. The Flow table lists every route found with its file name under it, the diagram has a box per route, and the Route pane has a tab per file, showing how many routes the selected row has in each (`0` greyed out). **Hide files without a route** (on by default, remembered in the browser) leaves out the tabs of files where the selected row has no route; untick it to see them all. A file that could not be pulled keeps its tab, and if no file has a route, all are shown. The first file with a route for the row opens; clicking a route box in the diagram opens its file's tab. The login needs read access to the folder listing as well as to the files.
- **Route flow**: under the Flow table, the selected row's route(s) step by step, in file order: `from`, `log`, `setHeader`/`setProperty` (with the value), `process`, `bean`, `to`, `wireTap`, `marshal`, … and blocks such as `choice` / `when` (with its condition) / `otherwise`, `doTry` / `doCatch` (with the exception), `split`, `filter`, nested under them. A call to another route (`direct:`, `direct-vm:`, `seda:`, `vm:`) is followed into the `<route>` whose `<from uri>` is that endpoint, in any pulled Route file, and shown nested under the call (a call back into a route already on the way is marked, not repeated). A call with no such route in the pulled files says so; widen the Endpoint File pattern (e.g. `*`) to pull more. A `bean:name?method=m` or `<bean method="m">` step links to the Controller (or API) method `m()` when there is one. Each step's file and line is a link to it in the Route pane. Followed routes (including those from Reference Files) start hidden, showing only their heading and how many steps they have: click a heading to **Expand** it (and again to **Hide** it), or use **Expand all** / **Hide all** at the top of the card. Expanded routes stay open on other rows and after pulling again, until the page is reloaded.
- **Reference File** (second file row of the Route box, with its own **Path**, as base routes often sit in another folder; `.xml`, `*` allowed; **+ Reference File** adds another row, e.g. for base routes in a third folder, and **×** removes it; the rows are remembered in the browser): the base routes file(s) that the routes call. They are not searched for the Endpoint method; they are pulled into extra tabs of the Route pane (marked **ref**, never hidden) and used to follow and check route references. A reference (`direct:x`, `seda:x`, …) is matched to the route whose `<from uri>` has the name `x` in any Route or Reference Route file, else to the route whose **id** is `x` (tagged *by route id*). Under the Route flow, the **Reference check** lists every reference once: ✓ with the route it leads to (tagged *Reference Route* when it is in a Reference Route file), or ✗ *not found*; the card header counts them (e.g. `5 of 5 references found`).
- **Fallback, API path → Route**: if no route matches by method name, the route file is searched as text (XML, properties, YAML, …). Lines holding a path pattern that matches the API path are shown: `{var}` and `*` match one segment, `**` any number, and a context path like `/spl-banking` may be on either side. If none match, lines containing at least three consecutive segments of the API path; with no API path, lines naming the Endpoint class. The Route pane then shows those lines with two lines of context, the same for every row.
- **API path → Endpoint**: the API path or full URL, e.g. `/spl-banking/enq/customer/portfolio/12345`, is matched against the Endpoint's Spring (`@RequestMapping`, `@GetMapping`, …) and JAX-RS (`@Path`, `@GET`, …) mappings, with class and method paths joined. A context-path prefix (`/spl-banking`), `{path}` variables and a query string are allowed for. Each matching Endpoint method is one row, marked **Exact match** or **Matches end of API**. With no API path, every mapping in the Endpoint is a row.
- **Endpoint → API, Controller**: the method with the Endpoint method's own name: for `processSubmitApi()`, the `processSubmitApi` method of the API file and of the Controller file, and only that method's section is shown (*(same name)* in the Flow table). In a file without a method of that name, the calls inside the Endpoint method are followed instead: calls on a field, parameter or variable whose type is the API interface or the Controller class (e.g. `portfolioApi.savePortfolio(…)`), each looked up by name in the API file and in the Controller file. If the Endpoint has no such field, calls to any method those files have. One Endpoint method can lead to several API and Controller methods.
- **Controller → Command, by `@CommandHandler`**: if the Controller method has `@CommandHandler(command = "SubmitApiCommand", validator = "SubmitApiValidator")` (on one line or several), that class is the Command. It is pulled from the same Project and Repository as the Controller, in the Controller's folder with the last `api` folder taken off and `processing/impl` added, as `<command>.java`: for a Controller in `/banking-api/src/main/java/com/api/`, the file `/banking-api/src/main/java/com/processing/impl/SubmitApiCommand.java`. (With no `api` folder in the path, `processing/impl` is just added.) The Command box is filled in with it; the Flow table shows `SubmitApiCommand (@CommandHandler; validator SubmitApiValidator)`, and the Command pane shows that whole class. Annotations inside comments are ignored.
- **Controller → Command, by calls** (no `@CommandHandler`): the same as for the API and Controller, one step further: calls inside those Controller methods on a field or variable of the Command's class (e.g. `command.enquire(…)`, or `new PortfolioCommand(…).execute()`), looked up in the Command file. Without a Controller file, the Endpoint method's calls are used.
- Static calls (`ClassName.method(…)`) count at every step.

After **Pull from Bitbucket**, the **Process** diagram draws the whole flow for the API in one picture: a lane per layer (Request, Endpoint, Route, API, Controller, Command; only for the files pulled), a box per method or route entry, and an arrow per call found (hover for the call, e.g. `portfolioApi.savePortfolio()`). The request reads as one chain: Request → Endpoint → its Route → API → Controller → Command. When the Endpoint method has a route, its calls onward are drawn from the Route box (hover to see the Endpoint method they are in). Dotted arrows mean "implemented by" (API → Controller). Arrows that skip a lane run through the gaps between lanes, so they cross no box. The selected row's path is highlighted; click a box to select its row and jump to its code.

Below it, the **Flow** table lists the rows (HTTP, Path, Match, Endpoint, Route, API, Controller, Command). Click a row (or use the arrow keys) to show its methods in the code panes below: each pane shows only the matching method(s), from the comments and annotations above down to the closing `}`, with the declarations and the Endpoint's calls highlighted. **Show whole file** switches a pane to the complete file; **Copy** copies what the pane shows. If no mapping matches the API path, the whole Endpoint file is shown.

## Security

- The server listens on `127.0.0.1` only. The password is held in the page's memory and passed through per request; it is never written to disk or browser storage.
- The API only accepts JSON requests from the StoryZLine page itself, so other websites open in your browser can't use it.
- A pasted file URL must be on the same host as the Bitbucket URL; others are rejected.

## Tests

`npm test`
