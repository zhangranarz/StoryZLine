# Demo kit

Try StoryZLine without a real Bitbucket: a pretend Bitbucket serves the sample Route, Endpoint, API, Controller, Command and Validator files in this folder.

## Start

1. In one window: `python tools/mock_bitbucket.py` (or your own `python.exe` with the full path). It listens on http://127.0.0.1:5199.
2. In another: start StoryZLine as usual (`start.cmd`, or `python server.py --open`).
3. **⚙ Settings**: click **Load** and choose `samples/demo-list.csv`, or type URL `http://127.0.0.1:5199`. Use any user ID and any password (the password `wrong` shows a failed login). Click **Log in**.

## Try it in the eComm tab

Fill in the five boxes (Project `DEMO`, Repository `ecomm-services`):

| Box | Path | File(s) |
|---|---|---|
| Endpoint | `src/main/java/com/example/ecomm/enq` | File `CustomerPortfolioEndpoint` |
| Route | `src/main/resources/routes` | File `portfolio-routes` (Extension `.xml`) |
| APIController | `src/main/java/com/example/ecomm/enq/controller` | API File `CustomerPortfolioApi`, Controller File `CustomerPortfolioController` |
| Command | `src/main/java/com/example/ecomm/enq/command` | File `CustomerPortfolioCommand` |
| Validator | `src/main/java/com/example/ecomm/enq/validator` | File `PortfolioRequestValidator` |

Then type an **API** and click **Pull from Bitbucket**:

| API | Flow rows: Endpoint → API → Controller (→ Command, Validator) |
|---|---|
| `/spl-banking/enq/customer/portfolio/12345` | `getPortfolio()` → `getPortfolio()` → `getPortfolio()` → `enquire()`; and `updatePortfolio()` (POST) → `validate()`, `savePortfolio()` → `validate()`, `savePortfolio()` → `update()`, Validator `checkPortfolio()`, `checkHoldings()` |
| `/enq/customer/overview` | `summary()` → `summary()` → `summary()`, exact match |
| `/enq/customer/portfolio/12345/export` | `exportPortfolio()` → `exportCsv()` → `exportCsv()` (the names differ along the way) |
| `/enq/customer/unknown` | none: the whole Endpoint file is shown |
| *(empty)* | every mapping in the Endpoint |

The **Process** diagram at the top of the results draws both rows: Request → Endpoint → route → API → Controller → Command, and on to the Validator for the POST. Click a row in Flow, or a box, to highlight one path.

`portfolio-routes.xml` is a Camel-style route file: each `<route>` starts `from` `direct:ecomm.portfolio_<Endpoint method>`. So the GET row's route is `ecomm.portfolio.get` (`_getPortfolio`) and the POST row's `ecomm.portfolio.update` (`_updatePortfolio`); the Route pane shows only the selected row's `<route>` section. `_getPortfolioHistory` and a commented-out route are deliberately not matched. (`gateway-routes.xml` is an older path-pattern style file, used when no route matches by name.)

How the demo is wired: the Endpoint holds a `CustomerPortfolioApi portfolioApi` field and calls it; `CustomerPortfolioController implements CustomerPortfolioApi` and calls `CustomerPortfolioCommand`, whose methods each send one host request (the made-up service codes are in its `SERVICE_` constants). The Controller's `validate()` hands its rules to `PortfolioRequestValidator` (`checkPortfolio()`, `checkHoldings()`), so the POST row reaches the Validator. (The Endpoint and Controller also call `PortfolioResponseBuilder`; it has no box in the page.) GET is matched to the API and Controller methods by its own name, `getPortfolio` (*(same name)* in the Flow table); the POST's `updatePortfolio` has no method of that name there, so the calls it makes are followed instead and reach two methods; the Endpoint's `audit.log(...)` calls are not counted, because `audit` is neither the API nor the Controller.

Also try:
- Clear the Controller File: the Controller column says *not pulled*, the API column still fills.
- `enterprise-services`, Path `src/main/java/com/example/enterprise`, File `AccountBalanceResource` in the Endpoint box (APIController files cleared), API `/accounts/123-456/balance`: a JAX-RS example.
- File `Missing` gives *File not found* in that pane; the password `wrong` gives *Bitbucket rejected the login*.
