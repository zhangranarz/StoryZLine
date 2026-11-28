package com.base.processor;

import org.apache.camel.Exchange;
import org.apache.camel.Processor;

/**
 * Checks a submitted payment before it goes on (demo file for StoryZLine; not real code).
 * Used in routes as bean:validateSubmitProcessor, defined in base-routes.xml.
 */
public class ValidateSubmitProcessor implements Processor {

    private static final int MAX_REFERENCE = 35;

    @Override
    public void process(Exchange exchange) throws Exception {
        String reference = exchange.getIn().getHeader("paymentReference", String.class);
        if (reference != null && reference.length() > MAX_REFERENCE) {
            throw new IllegalArgumentException("Payment reference too long");
        }
        exchange.setProperty("validated", Boolean.TRUE);
    }

    private boolean isBlank(String s) {
        return s == null || s.trim().isEmpty();
    }
}
