# Demo kit

Try StoryZLine without a real Bitbucket: a pretend Bitbucket serves the sample Endpoint, API and Controller files in this folder.

## Start

1. In one window: `python tools/mock_bitbucket.py` (or your own `python.exe` with the full path). It listens on http://127.0.0.1:5199.
2. In another: start StoryZLine as usual (`start.cmd`, or `python server.py --open`).
3. **⚙ Settings**: click **Load** and choose `samples/demo-list.csv`, or type URL `http://127.0.0.1:5199`. Use any user ID and any password (the password `wrong` shows a failed login). Click **Log in**.

## Try it in the eComm tab

Fill in the two boxes (Project `DEMO`, Repository `ecomm-services`, Extensions `.java`):

| Box | Path | File(s) |
|---|---|---|
| Endpoint | `src/main/java/com/example/ecomm/enq` | File `CustomerPortfolioEndpoint` |
| APIController | `src/main/java/com/example/ecomm/enq/controller` | API File `CustomerPortfolioApi`, Controller File `CustomerPortfolioController` |

Then type an **API** and click **Pull from Bitbucket**:

| API | Flow rows: Endpoint → API → Controller |
|---|---|
| `/spl-banking/enq/customer/portfolio/12345` | `getPortfolio()` → `getPortfolio()` → `getPortfolio()`, and `updatePortfolio()` (POST) → `validate()`, `savePortfolio()` → `validate()`, `savePortfolio()` |
| `/enq/customer/overview` | `summary()` → `summary()` → `summary()`, exact match |
| `/enq/customer/portfolio/12345/export` | `exportPortfolio()` → `exportCsv()` → `exportCsv()` (the names differ along the way) |
| `/enq/customer/unknown` | none: the whole Endpoint file is shown |
| *(empty)* | every mapping in the Endpoint |

How the demo is wired: the Endpoint holds a `CustomerPortfolioApi portfolioApi` field and calls it; `CustomerPortfolioController implements CustomerPortfolioApi`. The POST row reaches two methods; the Endpoint's `audit.log(...)` calls are not counted, because `audit` is neither the API nor the Controller.

Also try:
- Clear the Controller File: the Controller column says *not pulled*, the API column still fills.
- `enterprise-services`, Path `src/main/java/com/example/enterprise`, File `AccountBalanceResource` in the Endpoint box (APIController files cleared), API `/accounts/123-456/balance`: a JAX-RS example.
- File `Missing` gives *File not found* in that pane; the password `wrong` gives *Bitbucket rejected the login*.
