package com.example.enterprise;

import javax.ws.rs.*;
import javax.ws.rs.core.MediaType;
import javax.ws.rs.core.Response;

/**
 * Account enquiries in JAX-RS style (demo file for StoryZLine; not real code).
 */
@Path("/accounts")
@Produces(MediaType.APPLICATION_JSON)
public class AccountBalanceResource {

    private final AccountService accounts = new AccountService();

    /** Try API: /accounts/123-456/balance */
    @GET
    @Path("{accountId}/balance")
    public Response balance(@PathParam("accountId") String accountId) {
        return Response.ok(accounts.balance(accountId)).build();
    }

    /** Try API: /spl-banking/accounts/123-456/transactions?from=2024-01-01 */
    @GET
    @Path("{accountId}/transactions")
    public Response transactions(@PathParam("accountId") String accountId, @QueryParam("from") String from) {
        return Response.ok(accounts.transactions(accountId, from)).build();
    }

    /** Try API: /accounts/123-456/close */
    @POST
    @Path("{accountId}/close")
    public Response close(@PathParam("accountId") String accountId) {
        accounts.close(accountId);
        return Response.accepted().build();
    }
}
