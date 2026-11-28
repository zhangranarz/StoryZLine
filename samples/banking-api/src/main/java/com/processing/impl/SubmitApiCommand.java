package com.processing.impl;

/**
 * Sends a payment to the host (demo file for StoryZLine; not real code).
 * Named by @CommandHandler(command = "SubmitApiCommand") on PaymentController.processSubmitApi().
 */
public class SubmitApiCommand implements Command<SubmitRequest, SubmitResult> {

    static final String SERVICE = "DEMO_PAYMENT_SUBMIT";

    private final HostGateway host;

    public SubmitApiCommand(HostGateway host) {
        this.host = host;
    }

    @Override
    public SubmitResult execute(SubmitRequest request) {
        HostReply reply = host.send(new HostRequest(SERVICE)
            .with("debitAccount", request.getDebitAccount())
            .with("amount", request.getAmount()));
        return new SubmitResult(reply.get("paymentRef"), reply.getStatus());
    }
}
