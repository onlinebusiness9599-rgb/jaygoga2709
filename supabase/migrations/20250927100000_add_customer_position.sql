/*
# [Operation Name]
Add position column to customers table

## Query Description:
This operation adds a 'position' column to the 'customers' table to allow for custom sorting of the customer list. It defaults new entries to 0. A backfill script sets an initial order for existing customers based on their creation date to prevent issues. This change is non-destructive but will alter the table structure.

## Metadata:
- Schema-Category: "Structural"
- Impact-Level: "Low"
- Requires-Backup: false
- Reversible: true

## Structure Details:
- Table: public.customers
- Column Added: position (integer, default 0, not null)

## Security Implications:
- RLS Status: Unchanged
- Policy Changes: No
- Auth Requirements: None

## Performance Impact:
- Indexes: None
- Triggers: None
- Estimated Impact: Low. May cause a brief table lock on very large tables during the initial alteration.
*/
ALTER TABLE public.customers
ADD COLUMN position INTEGER NOT NULL DEFAULT 0;

-- Backfill existing customers with a position based on their creation date
-- to ensure a consistent initial order.
DO $$
DECLARE
    user_id_record RECORD;
BEGIN
    FOR user_id_record IN SELECT DISTINCT user_id FROM public.customers
    LOOP
        UPDATE public.customers c
        SET position = c.rn - 1
        FROM (
            SELECT id, ROW_NUMBER() OVER (ORDER BY created_at) as rn
            FROM public.customers
            WHERE user_id = user_id_record.user_id
        ) AS c_with_rn
        WHERE c.id = c_with_rn.id;
    END LOOP;
END $$;
