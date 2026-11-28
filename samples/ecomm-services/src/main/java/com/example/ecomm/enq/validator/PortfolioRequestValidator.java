package com.example.ecomm.enq.validator;

import java.util.List;

/**
 * Request checks for customer portfolios (demo file for StoryZLine; not real code).
 */
public final class PortfolioRequestValidator {

    private PortfolioRequestValidator() { }

    /** A portfolio must name its customer and currency. */
    public static void checkPortfolio(Portfolio portfolio) {
        if (portfolio == null || portfolio.getCustomerId() == null) {
            throw new IllegalArgumentException("A portfolio needs a customer");
        }
        if (portfolio.getCurrency() == null || portfolio.getCurrency().length() != 3) {
            throw new IllegalArgumentException("A portfolio needs a three-letter currency");
        }
    }

    /** At least one holding, and no negative quantities. */
    public static void checkHoldings(List<Holding> holdings) {
        if (holdings.isEmpty()) {
            throw new IllegalArgumentException("A portfolio needs at least one holding");
        }
        for (Holding h : holdings) {
            if (h.getQuantity() < 0) {
                throw new IllegalArgumentException("Negative quantity for holding " + h.getId());
            }
        }
    }

    /** Holding ids look like H-123. */
    public static void checkHoldingId(String holdingId) {
        if (holdingId == null || !holdingId.matches("H-\\d+")) {
            throw new IllegalArgumentException("Bad holding id: " + holdingId);
        }
    }
}
