package com.api;

import org.springframework.stereotype.Component;

/**
 * Payment controller (demo file for StoryZLine; not real code).
 * Each method names its Command class (in com.processing.impl) and validator.
 */
@Component
public class PaymentController implements PaymentApi {

    private final CommandBus commandBus;

    public PaymentController(CommandBus commandBus) {
        this.commandBus = commandBus;
    }

    /** Submits a payment through SubmitApiCommand. */
    @Override
    @CommandHandler(command = "SubmitApiCommand", validator = "SubmitApiValidator")
    public SubmitResult processSubmitApi(SubmitRequest request) {
        return commandBus.dispatch(request, SubmitResult.class);
    }

    /** Cancels a payment through CancelApiCommand. */
    @Override
    @CommandHandler(
        command = "CancelApiCommand",
        validator = "CancelApiValidator")
    public CancelResult processCancelApi(String paymentId) {
        return commandBus.dispatch(new CancelRequest(paymentId), CancelResult.class);
    }
}
