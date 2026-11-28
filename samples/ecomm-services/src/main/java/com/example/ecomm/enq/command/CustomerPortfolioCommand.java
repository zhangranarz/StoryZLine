package com.example.ecomm.enq.command;

import java.util.List;

/**
 * Backend calls for customer portfolios (demo file for StoryZLine; not real code).
 * Each method sends one request to the host service named by a SERVICE_ constant.
 */
public class CustomerPortfolioCommand {

    static final String SERVICE_ENQUIRY = "DEMO_PORTFOLIO_ENQ";
    static final String SERVICE_UPDATE = "DEMO_PORTFOLIO_UPD";
    static final String SERVICE_HOLDINGS = "DEMO_HOLDING_LST";

    private final HostGateway host;

    public CustomerPortfolioCommand(HostGateway host) {
        this.host = host;
    }

    /** Host enquiry: the portfolio of one customer. */
    public Portfolio enquire(String customerId) {
        HostRequest request = new HostRequest(SERVICE_ENQUIRY).with("customerId", customerId);
        return host.send(request).as(Portfolio.class);
    }

    /** Host update: replaces a customer's portfolio. */
    public void update(String customerId, Portfolio portfolio) {
        host.send(new HostRequest(SERVICE_UPDATE).with("customerId", customerId).with("portfolio", portfolio));
    }

    /** Host enquiry: totals over all portfolios. */
    public Summary summarise() {
        return host.send(new HostRequest(SERVICE_ENQUIRY).with("scope", "ALL")).as(Summary.class);
    }

    /** Host update: removes one holding. */
    public void deleteHolding(String customerId, String holdingId) {
        host.send(new HostRequest(SERVICE_UPDATE).with("customerId", customerId).with("deleteHolding", holdingId));
    }

    /** Host enquiry: the holdings of one customer. */
    public List<Holding> holdings(String customerId) {
        return host.send(new HostRequest(SERVICE_HOLDINGS).with("customerId", customerId)).asListOf(Holding.class);
    }
}
