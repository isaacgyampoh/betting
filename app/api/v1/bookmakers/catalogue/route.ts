import { ok, route } from "@/lib/api";
import { allEntries, coverage } from "@/lib/bookmakers/catalogue";

export const dynamic = "force-dynamic";

/**
 * The operator catalogue: who exists across Africa and how far we have got with each.
 *
 * Open, like /v1/bookmakers, because it is reference data about public companies and contains no
 * user data and no credentials.
 *
 * It is deliberately a *different* endpoint from /v1/bookmakers rather than an extension of it.
 * That one answers "what can this user convert right now", and the convert screen must keep asking
 * exactly that question; this one answers "what do we know about the market", which is a research
 * figure. Serving them from one endpoint is how a catalogue of 95 operators ends up presented as
 * 95 working integrations.
 */
export const GET = route(async () => ok({ coverage: coverage(), entries: allEntries() }));
