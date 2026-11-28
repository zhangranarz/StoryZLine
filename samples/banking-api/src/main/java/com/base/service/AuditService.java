package com.base.service;

/**
 * Writes audit records (demo file for StoryZLine; not real code).
 * Used in routes as bean:auditService?method=write, defined in base-routes.xml.
 */
public class AuditService {

    private final AuditStore store;

    public AuditService(AuditStore store) {
        this.store = store;
    }

    public void write(AuditRecord record) {
        store.save(record.withTimestamp(System.currentTimeMillis()));
    }

    public int pending() {
        return store.countPending();
    }
}
