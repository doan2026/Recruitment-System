BEGIN;

CREATE FUNCTION "company"."fold_public_company_search"(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
STRICT
AS $function$
    SELECT pg_catalog.btrim(
        pg_catalog.regexp_replace(
            pg_catalog.translate(
                pg_catalog.regexp_replace(
                    pg_catalog.normalize(pg_catalog.lower(value), 'NFD'),
                    U&'[\0300-\036f]',
                    '',
                    'g'
                ),
                'đ',
                'd'
            ),
            '[^a-z0-9]+',
            ' ',
            'g'
        )
    )
$function$;

CREATE INDEX "companies_public_verified_normalized_name_id_idx"
ON "company"."companies" USING btree ("normalized_name", "id")
WHERE "verified_status" = 'VERIFIED'::"company"."CompanyVerificationStatus";

CREATE INDEX "companies_public_verified_search_tsv_idx"
ON "company"."companies" USING gin (
    to_tsvector(
        'simple'::regconfig,
        "company"."fold_public_company_search"("name")
    )
)
WHERE "verified_status" = 'VERIFIED'::"company"."CompanyVerificationStatus";

COMMIT;
