package com.example.ecomm.enq.controller;

import org.springframework.stereotype.Component;

/**
 * Business logic behind CustomerPortfolioEndpoint (demo file for StoryZLine; not real code).
 */
@Component
public class CustomerPortfolioController {

    private final PortfolioRepository repository;

    public CustomerPortfolioController(PortfolioRepository repository) {
        this.repository = repository;
    }

    /** Loads a portfolio and converts it to the requested currency. */
    public Portfolio getPortfolio(String customerId, String currency) {
        Portfolio portfolio = repository.find(customerId);
        return portfolio.convertTo(currency);
    }

    /** Checks a portfolio before it is saved. */
    public void validate(Portfolio portfolio) {
        if (portfolio.getHoldings().isEmpty()) {
            throw new IllegalArgumentException("A portfolio needs at least one holding");
        }
    }

    /** Saves a whole portfolio. */
    public void savePortfolio(String customerId, Portfolio portfolio) {
        repository.save(customerId, portfolio);
    }

    public Summary summary() {
        return new Summary(repository.count(), repository.totalValue());
    }

    public void removeHolding(String customerId, String holdingId) {
        repository.deleteHolding(customerId, holdingId);
    }

    /** CSV export, one line per holding. */
    public byte[] exportCsv(String customerId) {
        StringBuilder csv = new StringBuilder("holding,quantity\n");
        for (Holding h : repository.find(customerId).getHoldings()) {
            csv.append(h.getId()).append(',').append(h.getQuantity()).append('\n');
        }
        return csv.toString().getBytes();
    }

    private Portfolio unused() { return null; }
}
