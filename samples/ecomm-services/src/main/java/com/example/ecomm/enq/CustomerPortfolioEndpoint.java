package com.example.ecomm.enq;

import java.util.List;

import com.example.ecomm.enq.api.CustomerPortfolioApi;
import com.example.ecomm.enq.controller.CustomerPortfolioController;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

/**
 * Customer portfolio enquiries (demo file for StoryZLine; not real code).
 *
 * Mapped under /enq/customer; the gateway adds a context path such as /spl-banking.
 */
@RestController
@RequestMapping(value = "/enq/customer", produces = "application/json")
public class CustomerPortfolioEndpoint implements CustomerPortfolioApi {

    private final CustomerPortfolioController controller;
    private final AuditLog audit;

    public CustomerPortfolioEndpoint(CustomerPortfolioController controller, AuditLog audit) {
        this.controller = controller;
        this.audit = audit;
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
        audit.log("getPortfolio", customerId);
        return ResponseEntity.ok(controller.getPortfolio(customerId, currency));
    }

    // Same path as above, but POST: both methods are shown for that API.
    @PostMapping(value = "/portfolio/{customerId}", consumes = "application/json")
    public ResponseEntity<Void> updatePortfolio(@PathVariable String customerId, @RequestBody Portfolio portfolio) {
        controller.validate(portfolio);
        controller.savePortfolio(customerId, portfolio);
        return ResponseEntity.noContent().build();
    }

    /** One method, two paths and two HTTP methods. Try API: /enq/customer/overview */
    @RequestMapping(path = {"/summary", "/overview"}, method = {RequestMethod.GET, RequestMethod.POST})
    public Summary summary() { return controller.summary(); }

    /** Try API: /spl-banking/enq/customer/portfolio/12345/holdings/H-9 */
    @DeleteMapping("/portfolio/{customerId}/holdings/{holdingId}")
    public void removeHolding(@PathVariable String customerId, @PathVariable String holdingId) {
        controller.removeHolding(customerId, holdingId);
    }

    /** Implements the API method; its mapping comes from CustomerPortfolioApi. */
    @Override
    public byte[] exportPortfolio(String customerId) {
        return controller.exportCsv(customerId);
    }

    // @GetMapping("/commented-out") - commented out, so not an endpoint.

    /** Not an endpoint: no mapping annotation. */
    private List<String> auditTrail(String customerId) {
        return audit.trail(customerId);
    }
}
