package com.api;

/**
 * Payment operations (demo file for StoryZLine; not real code).
 */
public interface PaymentApi {

    /** Submits a payment and returns its reference. */
    SubmitResult processSubmitApi(SubmitRequest request);

    /** Cancels an unsettled payment. */
    CancelResult processCancelApi(String paymentId);
}
