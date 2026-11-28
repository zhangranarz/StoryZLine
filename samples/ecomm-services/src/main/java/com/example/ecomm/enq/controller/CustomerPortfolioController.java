package com.example.ecomm.enq.controller;

import com.example.ecomm.enq.command.CustomerPortfolioCommand;
import org.springframework.stereotype.Component;

/**
 * Business logic behind CustomerPortfolioEndpoint (demo file for StoryZLine; not real code).
 * Backend calls go through CustomerPortfolioCommand.
 */
@Component
public class CustomerPortfolioController implements CustomerPortfolioApi {

    private final CustomerPortfolioCommand command;

    public CustomerPortfolioController(CustomerPortfolioCommand command) {
        this.command = command;
    }

    /** Loads a portfolio and converts it to the requested currency. */
    @Override
    public Portfolio getPortfolio(String customerId, String currency) {
        Portfolio portfolio = command.enquire(customerId);
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
        command.update(customerId, portfolio);
    }

    @Override
    public Summary summary() {
        return command.summarise();
    }

    @Override
    public void removeHolding(String customerId, String holdingId) {
        command.deleteHolding(customerId, holdingId);
    }

    @Override
    public byte[] exportCsv(String customerId) {
        StringBuilder csv = new StringBuilder("holding,quantity\n");
        for (Holding h : command.holdings(customerId)) {
            csv.append(h.getId()).append(',').append(h.getQuantity()).append('\n');
        }
        return csv.toString().getBytes();
    }

    private Portfolio unused() { return null; }
}
