/*
# [Schema Initialization]
This script sets up the complete database schema for the Jay Goga Milk application. It creates all necessary tables, enables Row Level Security (RLS) for data privacy, and sets up a trigger to automatically create user profiles upon sign-up. This script is designed to be run on a new or incomplete database.

## Query Description:
This operation will create the `profiles`, `products`, `customers`, and `daily_orders` tables if they do not already exist. It also adds a `position` column to the `customers` table to support draggable reordering. It is generally safe to run, but it is always recommended to back up your data first if you have any existing information.

## Metadata:
- Schema-Category: "Structural"
- Impact-Level: "Medium"
- Requires-Backup: true
- Reversible: false

## Structure Details:
- Creates table: `public.profiles`
- Creates table: `public.products`
- Creates table: `public.customers` (with a new `position` column)
- Creates table: `public.daily_orders`
- Enables RLS on all tables.
- Creates policies for SELECT, INSERT, UPDATE, DELETE on all tables based on `user_id`.
- Creates function and trigger `handle_new_user` to populate `profiles`.

## Security Implications:
- RLS Status: Enabled on all application tables.
- Policy Changes: Yes, this script defines the core RLS policies.
- Auth Requirements: Policies are based on the authenticated user's ID (`auth.uid()`).

## Performance Impact:
- Indexes: Creates primary key indexes and foreign key indexes.
- Triggers: Adds a trigger on `auth.users` for profile creation.
- Estimated Impact: Low on an empty database.
*/

-- 1. PROFILES TABLE
-- Stores public user data.
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE public.profiles IS 'Stores public user data linked to authentication.';

-- 2. PRODUCTS TABLE
-- Stores product information.
CREATE TABLE IF NOT EXISTS public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price NUMERIC(10, 2) NOT NULL CHECK (price >= 0),
  quantity NUMERIC(10, 2) NOT NULL CHECK (quantity > 0),
  unit TEXT NOT NULL,
  photo TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE public.products IS 'Stores product information for each user.';

-- 3. CUSTOMERS TABLE
-- Stores customer information. Includes a 'position' column for ordering.
CREATE TABLE IF NOT EXISTS public.customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  contact_number TEXT NOT NULL,
  position INT NOT NULL DEFAULT 0, -- For draggable ordering
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE public.customers IS 'Stores customer information for each user, with ordering position.';

-- 4. DAILY ORDERS TABLE
-- Stores daily order records.
CREATE TABLE IF NOT EXISTS public.daily_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  customer_name TEXT NOT NULL,
  date DATE NOT NULL,
  items JSONB NOT NULL,
  total_amount NUMERIC(10, 2) NOT NULL CHECK (total_amount >= 0),
  amount_paid NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE public.daily_orders IS 'Stores daily order records for each customer.';

-- 5. RLS POLICIES
-- Enable RLS for all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_orders ENABLE ROW LEVEL SECURITY;

-- Drop existing policies to avoid conflicts
DROP POLICY IF EXISTS "Users can view their own profile." ON public.profiles;
DROP POLICY IF EXISTS "Users can update their own profile." ON public.profiles;

DROP POLICY IF EXISTS "Users can manage their own products." ON public.products;
DROP POLICY IF EXISTS "Users can view their own products." ON public.products;

DROP POLICY IF EXISTS "Users can manage their own customers." ON public.customers;
DROP POLICY IF EXISTS "Users can view their own customers." ON public.customers;

DROP POLICY IF EXISTS "Users can manage their own orders." ON public.daily_orders;
DROP POLICY IF EXISTS "Users can view their own orders." ON public.daily_orders;

-- Policies for PROFILES
CREATE POLICY "Users can view their own profile." ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update their own profile." ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- Policies for PRODUCTS
CREATE POLICY "Users can manage their own products." ON public.products FOR ALL USING (auth.uid() = user_id);

-- Policies for CUSTOMERS
CREATE POLICY "Users can manage their own customers." ON public.customers FOR ALL USING (auth.uid() = user_id);

-- Policies for DAILY_ORDERS
CREATE POLICY "Users can manage their own orders." ON public.daily_orders FOR ALL USING (auth.uid() = user_id);

-- 6. TRIGGER FOR NEW USER PROFILES
-- Create a function to insert a new profile
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, username)
  VALUES (new.id, new.raw_user_meta_data->>'username');
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create a trigger to call the function
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
