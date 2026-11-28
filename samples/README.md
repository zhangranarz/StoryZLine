# Demo kit

Try StoryZLine without a real Bitbucket: a pretend Bitbucket serves the sample API, Endpoint and Controller files in this folder.

## Start

1. In one window: `python tools/mock_bitbucket.py` (or your own `python.exe` with the full path). It listens on http://127.0.0.1:5199.
2. In another: start StoryZLine as usual (`start.cmd`, or `python server.py --open`).
3. **⚙ Settings**: click **Load** and choose `samples/demo-list.csv`, or type URL `http://127.0.0.1:5199`. Use any user ID and any password (the password `wrong` shows a failed login). Click **Log in**.

## Try it in the eComm tab

Fill in the three boxes (Project `DEMO`, Repository `ecomm-services`, Extension `.java`):

| Box | Path | File |
|---|---|---|
| API | `src/main/java/com/example/ecomm/enq/api` | `CustomerPortfolioApi` |
| Endpoint | `src/main/java/com/example/ecomm/enq` | `CustomerPortfolioEndpoint` |
| Controller | `src/main/java/com/example/ecomm/enq/controller` | `CustomerPortfolioController` |

Click **Pull from Bitbucket**. The **Flow** table should show five rows, all linked end to end:

| HTTP | Path | API | Endpoint | Controller |
|---|---|---|---|---|
| GET | `/enq/customer/portfolio/{customerId}` | `getPortfolio()` | `getPortfolio()` (same path) | `getPortfolio()` |
| POST | `/enq/customer/portfolio/{customerId}` | `updatePortfolio()` | `updatePortfolio()` (same path) | `validate()`, `savePortfolio()` |
| GET | `/enq/customer/summary` | `summary()` | `summary()` (same path) | `summary()` |
| DELETE | `/enq/customer/portfolio/{customerId}/holdings/{holdingId}` | `removeHolding()` | `removeHolding()` (same path) | `removeHolding()` |
| GET | `/enq/customer/portfolio/{customerId}/export` | `exportPortfolio()` | `exportPortfolio()` (same method name) | `exportCsv()` |

Things to notice: the POST row reaches two Controller methods; the export row is matched by name, because the Endpoint implements the interface without repeating its mapping, and leads to a Controller method with a different name; the Endpoint's `audit.log(...)` calls are not counted, because `audit` isn't the Controller.

Also try:
- Clear the API box's File and pull again: the rows start from the Endpoint's own mappings.
- `enterprise-services`, Path `src/main/java/com/example/enterprise`, File `AccountBalanceResource` in the Endpoint box only: a JAX-RS example.
- File `Missing` gives *File not found* in that pane; the password `wrong` gives *Bitbucket rejected the login*.
