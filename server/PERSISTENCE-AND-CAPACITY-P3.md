# Lesson Hub persistence and capacity contract (P3)

The current pilot storage remains an atomic JSON store. P3 adds a serialized transaction API, rollback on failed mutations, reproducible capacity testing and an NDJSON migration bundle with per-file SHA-256 checksums.

## Verified pilot envelope

The release gate exercises 300 users, 5,000 lesson resources and 120 concurrent mutation requests on one Node.js process. Correctness is mandatory: no lost mutation, valid JSON after reload and a verifiable migration export.

## Database migration triggers

Migrate to a transactional database before any of these conditions:

- multiple Lesson Hub server processes or replicas;
- sustained store size above 25 MiB;
- more than 10,000 active resources;
- production p95 write latency above 1,000 ms;
- need for cross-school tenancy, advanced search or external reporting.

Run `npm run test:capacity` on the target server and archive `server/output/capacity-report.json`. Run `npm run export:migration -- <data-file> <output-dir>` before changing the persistence driver.
