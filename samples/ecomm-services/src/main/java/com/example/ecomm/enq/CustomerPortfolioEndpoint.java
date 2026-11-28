package com.example.ecomm.enq;

import java.util.List;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

/**
 * Customer portfolio enquiries (demo file for StoryZLine; not real code).
 *
 * Mapped under /enq/customer; the gateway adds a context path such as /spl-banking.
 */
@RestController
@RequestMapping(value = "/enq/customer", produces = "application/json")
public class CustomerPortfolioEndpoint {

    private final PortfolioService service;

    public CustomerPortfolioEndpoint(PortfolioService service) {
        this.service = service;
    }

    /**
     * Portfolio of one customer.
     * Try API: /spl-banking/enq/customer/portfolio/12345
     */
    @GetMapping("/portfolio/{customerId}")
    public ResponseEntity<Portfolio> getPortfolio(@PathVariable("customerId") String customerId,
                                                  @RequestParam(defaultValue = "SGD") String currency) {
        if (customerId == null || customerId.isBlank()) {
            return ResponseEntity.badRequest().build();
        }
        String note = "braces inside text { } must not end the method";
        return ResponseEntity.ok(service.find(customerId, currency));
    }

    // Same path as above, but POST: both methods are shown for that API.
    @PostMapping(value = "/portfolio/{customerId}", consumes = "application/json")
    public ResponseEntity<Void> updatePortfolio(@PathVariable String customerId, @RequestBody Portfolio portfolio) {
        service.save(customerId, portfolio);
        return ResponseEntity.noContent().build();
    }

    /** One method, two paths and two HTTP methods. Try API: /enq/customer/overview */
    @RequestMapping(path = {"/summary", "/overview"}, method = {RequestMethod.GET, RequestMethod.POST})
    public Summary summary() { return service.summary(); }

    /** Try API: /spl-banking/enq/customer/portfolio/12345/holdings/H-9 */
    @DeleteMapping("/portfolio/{customerId}/holdings/{holdingId}")
    public void removeHolding(@PathVariable String customerId, @PathVariable String holdingId) {
        service.removeHolding(customerId, holdingId);
    }

    // @GetMapping("/commented-out") - commented out, so not an endpoint.

    /** Not an endpoint: no mapping annotation. */
    private List<String> auditTrail(String customerId) {
        return service.audit(customerId);
    }
}
