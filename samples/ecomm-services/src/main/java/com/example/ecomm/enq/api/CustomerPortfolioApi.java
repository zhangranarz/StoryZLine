package com.example.ecomm.enq.api;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

/**
 * The customer portfolio API contract (demo file for StoryZLine; not real code).
 * CustomerPortfolioEndpoint implements it.
 */
@RequestMapping("/enq/customer")
public interface CustomerPortfolioApi {

    /** Portfolio of one customer. */
    @GetMapping("/portfolio/{customerId}")
    ResponseEntity<Portfolio> getPortfolio(@PathVariable("customerId") String customerId,
                                           @RequestParam(defaultValue = "SGD") String currency);

    /** Replace a customer's portfolio. */
    @PostMapping(value = "/portfolio/{customerId}", consumes = "application/json")
    ResponseEntity<Void> updatePortfolio(@PathVariable String customerId, @RequestBody Portfolio portfolio);

    /** Summary of all portfolios. */
    @GetMapping("/summary")
    Summary summary();

    /** Remove one holding. */
    @DeleteMapping("/portfolio/{customerId}/holdings/{holdingId}")
    void removeHolding(@PathVariable String customerId, @PathVariable String holdingId);

    /** Export as CSV. The Endpoint implements this without repeating the mapping. */
    @GetMapping("/portfolio/{customerId}/export")
    byte[] exportPortfolio(@PathVariable String customerId);
}
