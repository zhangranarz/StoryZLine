# Demo kit

Try StoryZLine without a real Bitbucket: a pretend Bitbucket serves the sample Endpoint and Controller files in this folder.

## Start

1. In one window: `python tools/mock_bitbucket.py` (or your own `python.exe` with the full path). It listens on http://127.0.0.1:5199.
2. In another: start StoryZLine as usual (`start.cmd`, or `python server.py --open`).
3. **⚙ Settings**: click **Load** and choose `samples/demo-list.csv`, or type URL `http://127.0.0.1:5199`. Use any user ID and any password (the password `wrong` shows a failed login). Click **Log in**.

## Try it in the eComm tab

Fill in the two boxes (Project `DEMO`, Repository `ecomm-services`, Extension `.java`):

| Box | Path | File |
|---|---|---|
| Endpoint | `src/main/java/com/example/ecomm/enq` | `CustomerPortfolioEndpoint` |
| Controller | `src/main/java/com/example/ecomm/enq/controller` | `CustomerPortfolioController` |

Then type an **API** and click **Pull from Bitbucket**:

| API | Flow rows: Endpoint → Controller |
|---|---|
| `/spl-banking/enq/customer/portfolio/12345` | `getPortfolio()` → `getPortfolio()`, and `updatePortfolio()` (POST) → `validate()`, `savePortfolio()` |
| `/enq/customer/overview` | `summary()` → `summary()`, exact match |
| `/spl-banking/enq/customer/portfolio/12345/holdings/H-9` | `removeHolding()` (DELETE) → `removeHolding()` |
| `/enq/customer/unknown` | none: the whole Endpoint file is shown |
| *(empty)* | every mapping in the Endpoint |

Things to notice: the POST row reaches two Controller methods; the Endpoint's `audit.log(...)` calls are not counted, because `audit` isn't the Controller.

Also try:
- `enterprise-services`, Path `src/main/java/com/example/enterprise`, File `AccountBalanceResource` in the Endpoint box (Controller File cleared), API `/accounts/123-456/balance`: a JAX-RS example.
- File `Missing` gives *File not found* in that pane; the password `wrong` gives *Bitbucket rejected the login*.
