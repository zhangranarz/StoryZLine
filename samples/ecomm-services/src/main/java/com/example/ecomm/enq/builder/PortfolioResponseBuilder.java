package com.example.ecomm.enq.builder;

import java.util.List;
import java.util.Set;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

/**
 * Turns host results into API responses (demo file for StoryZLine; not real code).
 */
public final class PortfolioResponseBuilder {

    /** Host status codes that mean success. */
    static final Set<String> SUCCESS = Set.of("0000000", "0005000");

    private PortfolioResponseBuilder() { }

    /** 200 with the portfolio, 404 when there is none, or an error for a failed host status. */
    public static ResponseEntity<Portfolio> portfolio(Portfolio portfolio) {
        if (portfolio == null) {
            return ResponseEntity.notFound().build();
        }
        return SUCCESS.contains(portfolio.getHostStatus()) ? ResponseEntity.ok(portfolio) : error(portfolio.getHostStatus());
    }

    /** 204 after a successful update. */
    public static ResponseEntity<Void> noContent() {
        return ResponseEntity.noContent().build();
    }

    /** Maps a failed host status to an HTTP status. */
    public static <T> ResponseEntity<T> error(String hostStatus) {
        HttpStatus status = hostStatus != null && hostStatus.startsWith("01") ? HttpStatus.BAD_REQUEST : HttpStatus.BAD_GATEWAY;
        return ResponseEntity.status(status).header("X-Host-Status", hostStatus).build();
    }

    /** CSV export, one line per holding. */
    public static byte[] csv(List<Holding> holdings) {
        StringBuilder csv = new StringBuilder("holding,quantity\n");
        for (Holding h : holdings) {
            csv.append(h.getId()).append(',').append(h.getQuantity()).append('\n');
        }
        return csv.toString().getBytes();
    }
}
