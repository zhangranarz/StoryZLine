package com.api;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

/**
 * Payment submission (demo file for StoryZLine; not real code).
 * Try API: /spl-banking/payments/submit
 */
@RestController
@RequestMapping("/payments")
public class PaymentEndpoint {

    private final PaymentApi paymentApi;

    public PaymentEndpoint(PaymentApi paymentApi) {
        this.paymentApi = paymentApi;
    }

    /** Submits a payment. */
    @PostMapping("/submit")
    public ResponseEntity<SubmitResult> processSubmitApi(@RequestBody SubmitRequest request) {
        return ResponseEntity.ok(paymentApi.processSubmitApi(request));
    }

    /** Cancels a payment that has not been settled yet. */
    @PostMapping("/cancel/{paymentId}")
    public ResponseEntity<CancelResult> processCancelApi(@PathVariable String paymentId) {
        return ResponseEntity.ok(paymentApi.processCancelApi(paymentId));
    }
}
