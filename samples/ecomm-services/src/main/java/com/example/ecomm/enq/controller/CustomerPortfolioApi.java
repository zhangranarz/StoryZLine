package com.example.ecomm.enq.controller;

/**
 * What the Endpoint can ask of the portfolio controller (demo file for StoryZLine; not real code).
 * CustomerPortfolioController implements it.
 */
public interface CustomerPortfolioApi {

    /** Loads a portfolio in the requested currency. */
    Portfolio getPortfolio(String customerId, String currency);

    /** Checks a portfolio before it is saved. */
    void validate(Portfolio portfolio);

    /** Saves a whole portfolio. */
    void savePortfolio(String customerId, Portfolio portfolio);

    Summary summary();

    void removeHolding(String customerId, String holdingId);

    /** CSV export, one line per holding. */
    byte[] exportCsv(String customerId);
}
