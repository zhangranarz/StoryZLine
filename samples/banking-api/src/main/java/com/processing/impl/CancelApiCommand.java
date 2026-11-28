package com.processing.impl;

/**
 * Cancels a payment at the host (demo file for StoryZLine; not real code).
 * Named by @CommandHandler(command = "CancelApiCommand") on PaymentController.processCancelApi().
 */
public class CancelApiCommand implements Command<CancelRequest, CancelResult> {

    static final String SERVICE = "DEMO_PAYMENT_CANCEL";

    private final HostGateway host;

    public CancelApiCommand(HostGateway host) {
        this.host = host;
    }

    @Override
    public CancelResult execute(CancelRequest request) {
        HostReply reply = host.send(new HostRequest(SERVICE).with("paymentRef", request.getPaymentId()));
        return new CancelResult(reply.getStatus());
    }
}
