package com.example.ecomm.enq.controller;

import org.springframework.stereotype.Component;

/**
 * Business logic behind CustomerPortfolioEndpoint (demo file for StoryZLine; not real code).
 */
@Component
public class CustomerPortfolioController implements CustomerPortfolioApi {

    private final PortfolioRepository repository;

    public CustomerPortfolioController(PortfolioRepository repository) {
        this.repository = repository;
    }

    /** Loads a portfolio and converts it to the requested currency. */
    @Override
    public Portfolio getPortfolio(String customerId, String currency) {
        Portfolio portfolio = repository.find(customerId);
        return portfolio.convertTo(currency);
    }

    @Override
    public void validate(Portfolio portfolio) {
        if (portfolio.getHoldings().isEmpty()) {
            throw new IllegalArgumentException("A portfolio needs at least one holding");
        }
    }

    @Override
    public void savePortfolio(String customerId, Portfolio portfolio) {
        repository.save(customerId, portfolio);
    }

    @Override
    public Summary summary() {
        return new Summary(repository.count(), repository.totalValue());
    }

    @Override
    public void removeHolding(String customerId, String holdingId) {
        repository.deleteHolding(customerId, holdingId);
    }

    @Override
    public byte[] exportCsv(String customerId) {
        StringBuilder csv = new StringBuilder("holding,quantity\n");
        for (Holding h : repository.find(customerId).getHoldings()) {
            csv.append(h.getId()).append(',').append(h.getQuantity()).append('\n');
        }
        return csv.toString().getBytes();
    }

    private Portfolio unused() { return null; }
}
