package com.base.processor;

import org.apache.camel.Exchange;
import org.apache.camel.Processor;

/**
 * Rejects a payment request without an amount (demo file for StoryZLine; not real code).
 * Used in routes as <process ref="paymentRequestCheck"/>, defined in base-routes.xml.
 */
public class PaymentRequestCheck implements Processor {

    @Override
    public void process(Exchange exchange) throws Exception {
        Object amount = exchange.getIn().getHeader("amount");
        if (amount == null) {
            throw new IllegalArgumentException("Amount is missing");
        }
    }
}
