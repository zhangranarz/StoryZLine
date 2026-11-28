# Demo kit

Try StoryZLine without a real Bitbucket: a pretend Bitbucket serves the sample Endpoint files in this folder.

## Start

1. In one window: `python tools/mock_bitbucket.py` (or your own `python.exe` with the full path). It listens on http://127.0.0.1:5199.
2. In another: start StoryZLine as usual (`start.cmd`, or `python server.py --open`).
3. **⚙ Settings**: click **Load** and choose `samples/demo-list.csv`, or type URL `http://127.0.0.1:5199`. Use any user ID and any password (the password `wrong` shows a failed login). Click **Log in**.

## Try these in the eComm tab

Set **Project** `DEMO`, then the **Repository**, **Path** and **File** below; **Extension** `.java`.

**Repository `ecomm-services`**, Path `src/main/java/com/example/ecomm/enq`, File `CustomerPortfolioEndpoint`:

| API | Shows |
|---|---|
| `/spl-banking/enq/customer/portfolio/12345` | `getPortfolio()` (GET) and `updatePortfolio()` (POST), two sections |
| `/enq/customer/overview` | `summary()`, exact match (one method with two paths) |
| `/spl-banking/enq/customer/portfolio/12345/holdings/H-9` | `removeHolding()` (DELETE) |
| `/enq/customer/unknown` | no mapping matched: the whole file |
| *(empty)* | the whole file |

**Repository `enterprise-services`**, Path `src/main/java/com/example/enterprise`, File `AccountBalanceResource` (JAX-RS):

| API | Shows |
|---|---|
| `/accounts/123-456/balance` | `balance()`, exact match |
| `/spl-banking/accounts/123-456/transactions?from=2024-01-01` | `transactions()` |
| `/accounts/123-456/close` | `close()` (POST) |

Errors to try: File `Missing` gives *File not found*; password `wrong` gives *Bitbucket rejected the login*.
