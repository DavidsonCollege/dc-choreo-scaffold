# Passport schema copy

`passport-v1.json` is a copy of `schemas/passport/v1.schema.json` from DavidsonChoreo/dc-choreo-workflows, taken at 87314e2 (after DavidsonChoreo/dc-choreo-workflows#26, which widens `regulations` to every framework in item 8.1). The CLI validates every passport it writes against this copy, with `src/validate.js`, so it never writes one that the passport check would reject.

Don't edit it here. When the schema changes in dc-choreo-workflows, copy the new file over this one. CI compares the two.
