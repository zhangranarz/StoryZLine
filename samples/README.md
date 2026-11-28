# Demo kit

Try StoryZLine without a real Bitbucket: a pretend Bitbucket serves the sample Route, Endpoint, API, Controller and Command files in this folder.

## Start

1. In one window: `python tools/mock_bitbucket.py` (or your own `python.exe` with the full path). It listens on http://127.0.0.1:5199.
2. In another: start StoryZLine as usual (`start.cmd`, or `python server.py --open`).
3. **⚙ Settings**: click **Load** and choose `samples/demo-list.csv`, or type URL `http://127.0.0.1:5199`. Use any user ID and any password (the password `wrong` shows a failed login). Click **Log in**.

## Try it in the eComm tab

Fill in the four boxes (Project `DEMO`, Repository `ecomm-services`):

| Box | Path | File(s) |
|---|---|---|
| Endpoint | `src/main/java/com/example/ecomm/enq` | File `CustomerPortfolioEndpoint` |
| Route | `src/main/resources/routes` | Endpoint File `portfolio-routes` (Extension `.xml`); Reference File empty |
| APIController | `src/main/java/com/example/ecomm/enq/controller` | API File `CustomerPortfolioApi`, Controller File `CustomerPortfolioController` |
| Command | `src/main/java/com/example/ecomm/enq/command` | File `CustomerPortfolioCommand` |

Then type an **API** and click **Pull from Bitbucket**:

| API | Flow rows: Endpoint → API → Controller (→ Command) |
|---|---|
| `/spl-banking/enq/customer/portfolio/12345` | `getPortfolio()` → `getPortfolio()` → `getPortfolio()` → `enquire()`; and `updatePortfolio()` (POST) → `validate()`, `savePortfolio()` → `validate()`, `savePortfolio()` → `update()` |
| `/enq/customer/overview` | `summary()` → `summary()` → `summary()`, exact match |
| `/enq/customer/portfolio/12345/export` | `exportPortfolio()` → `exportCsv()` → `exportCsv()` (the names differ along the way) |
| `/enq/customer/unknown` | none: the whole Endpoint file is shown |
| *(empty)* | every mapping in the Endpoint |

The **Process** diagram at the top of the results draws both rows: Request → Endpoint → route → API → Controller → Command. Click a row in Flow, or a box, to highlight one path.

`portfolio-routes.xml` is a Camel-style route file: each `<route>` starts `from` `direct:ecomm.portfolio_<Endpoint method>`. So the GET row's route is `ecomm.portfolio.get` (`_getPortfolio`) and the POST row's `ecomm.portfolio.update` (`_updatePortfolio`); the Route pane shows only the selected row's `<route>` section. `_getPortfolioHistory` and a commented-out route are deliberately not matched. (`gateway-routes.xml` is an older path-pattern style file, used when no route matches by name.)

How the demo is wired: the Endpoint holds a `CustomerPortfolioApi portfolioApi` field and calls it; `CustomerPortfolioController implements CustomerPortfolioApi` and calls `CustomerPortfolioCommand`, whose methods each send one host request (the made-up service codes are in its `SERVICE_` constants). (The Endpoint and Controller also call `PortfolioRequestValidator` and `PortfolioResponseBuilder`; they have no box in the page.) GET is matched to the API and Controller methods by its own name, `getPortfolio` (*(same name)* in the Flow table); the POST's `updatePortfolio` has no method of that name there, so the calls it makes are followed instead and reach two methods; the Endpoint's `audit.log(...)` calls are not counted, because `audit` is neither the API nor the Controller.

Also try:
- Clear the Controller File: the Controller column says *not pulled*, the API column still fills.
- `enterprise-services`, Path `src/main/java/com/example/enterprise`, File `AccountBalanceResource` in the Endpoint box (APIController files cleared), API `/accounts/123-456/balance`: a JAX-RS example.
- File `Missing` gives *File not found* in that pane; the password `wrong` gives *Bitbucket rejected the login*.

## @CommandHandler: the banking-api repository

Here the Command is not typed in: it is found from the Controller. Repository `banking-api` in each box:

| Box | Path | File(s) |
|---|---|---|
| Endpoint | `src/main/java/com/api` | File `PaymentEndpoint` |
| Route | `src/main/resources/routes` | Endpoint File `payment-routes` (Extension `.xml`); Reference File empty |
| APIController | `src/main/java/com/api` | API File `PaymentApi`, Controller File `PaymentController` |
| Command | *(leave empty)* | |

API `/spl-banking/payments/submit`: Endpoint `processSubmitApi()` → route `payments.submit` → API and Controller `processSubmitApi()` *(same name)*. That Controller method has `@CommandHandler(command = "SubmitApiCommand", validator = "SubmitApiValidator")`, so `src/main/java/com/processing/impl/SubmitApiCommand.java` (the Controller's folder without `api`, plus `processing/impl`) is pulled, and the Command box is filled in with it. Try `/spl-banking/payments/cancel/77` too: its `@CommandHandler` is written over three lines and leads to `CancelApiCommand`.

### Several Route files: `payment*`

In the same setup, put `payment*` as the Endpoint File (Extension `.xml`). The routes folder holds `payment-routes.xml`, `payment-spl-1.1.xml`, `payment-v-1.1.xml` and `refund-routes.xml`; the first three are pulled, `refund-routes.xml` is left out. With API `/spl-banking/payments/submit` each file has a route for `processSubmitApi` (`payments.submit`, `payments.spl.submit`, `payments.v1.submit`), so the Route pane shows three tabs with `1` each. With `/spl-banking/payments/cancel/77`, `payment-v-1.1.xml` has no cancel route: its tab shows `0`, and is hidden while **Hide files without a route** is ticked ("1 hidden").

The **Route flow** card for the submit row then shows how `payments.submit` runs: `log`, a call to `direct:payments.validate` (followed: a `doTry` with a `doCatch` for `IllegalArgumentException` that sets HTTP 400 and stops), then a `choice`: when the `channel` header is `SPL` it goes to `direct:payments.spl_processSubmitApi` (followed into `payment-spl-1.1.xml`, which calls `direct:spl.audit` there), otherwise to `bean:paymentController?method=processSubmitApi` (linked to the Controller method). The audit route's `seda:audit.write` has no route in the payment files, and is marked *not found*. Now put `base-routes` as the **Reference File**, with its own Path `src/main/resources/routes/base`: `seda:audit.write` is found in `base-routes.xml` by its `<from uri>`, and the `direct:base.mask` it calls is found by route id (the `base.mask` route starts with another uri); the Reference check shows 5 of 6 references found: `base.mask` calls `direct:common.trace`, which is in another folder. Click **+ Reference File** and fill in Path `src/main/resources/routes/common`, File `common-routes`: pull again, and all 6 are found.
