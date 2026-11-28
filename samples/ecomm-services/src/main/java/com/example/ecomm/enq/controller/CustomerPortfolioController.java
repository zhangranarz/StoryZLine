package com.example.ecomm.enq.controller;

import com.example.ecomm.enq.builder.PortfolioResponseBuilder;
import com.example.ecomm.enq.command.CustomerPortfolioCommand;
import com.example.ecomm.enq.validator.PortfolioRequestValidator;
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
        // The rules themselves live in PortfolioRequestValidator.
        PortfolioRequestValidator.checkPortfolio(portfolio);
        PortfolioRequestValidator.checkHoldings(portfolio.getHoldings());
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
        return PortfolioResponseBuilder.csv(command.holdings(customerId));
    }

    private Portfolio unused() { return null; }
}
