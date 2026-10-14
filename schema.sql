CREATE TABLE IF NOT EXISTS properties (
  property_id TEXT PRIMARY KEY,
  property_name TEXT NOT NULL,
  location TEXT NOT NULL,
  property_type TEXT NOT NULL,
  listing_type TEXT NOT NULL,
  bhk INTEGER NOT NULL DEFAULT 1,
  area_sqft NUMERIC NOT NULL DEFAULT 0,
  bathrooms INTEGER NOT NULL DEFAULT 1,
  parking_spaces INTEGER NOT NULL DEFAULT 0,
  age_years INTEGER NOT NULL DEFAULT 0,
  metro_distance_km NUMERIC NOT NULL DEFAULT 0,
  it_park_distance_km NUMERIC NOT NULL DEFAULT 0,
  mall_distance_km NUMERIC NOT NULL DEFAULT 0,
  school_distance_km NUMERIC NOT NULL DEFAULT 0,
  hospital_distance_km NUMERIC NOT NULL DEFAULT 0,
  traffic_index NUMERIC NOT NULL DEFAULT 0,
  greenery_index NUMERIC NOT NULL DEFAULT 0,
  security_score NUMERIC NOT NULL DEFAULT 0,
  furnishing TEXT NOT NULL DEFAULT 'Unfurnished',
  balconies INTEGER NOT NULL DEFAULT 0,
  amenities_score NUMERIC NOT NULL DEFAULT 0,
  gym INTEGER NOT NULL DEFAULT 0,
  swimming_pool INTEGER NOT NULL DEFAULT 0,
  clubhouse INTEGER NOT NULL DEFAULT 0,
  lift INTEGER NOT NULL DEFAULT 0,
  price_2022 NUMERIC NOT NULL DEFAULT 0,
  price_2023 NUMERIC NOT NULL DEFAULT 0,
  price_2024 NUMERIC NOT NULL DEFAULT 0,
  price_2025 NUMERIC NOT NULL DEFAULT 0,
  current_price NUMERIC NOT NULL DEFAULT 0,
  demand_index NUMERIC NOT NULL DEFAULT 0,
  supply_index NUMERIC NOT NULL DEFAULT 0,
  infrastructure_growth_score NUMERIC NOT NULL DEFAULT 0,
  future_growth_score NUMERIC NOT NULL DEFAULT 0,
  rental_demand_score NUMERIC NOT NULL DEFAULT 0,
  upcoming_metro_impact NUMERIC NOT NULL DEFAULT 0,
  expected_short_term_growth_pct NUMERIC NOT NULL DEFAULT 0,
  road_connectivity_score NUMERIC NOT NULL DEFAULT 0,
  commercial_development NUMERIC NOT NULL DEFAULT 0,
  residential_development NUMERIC NOT NULL DEFAULT 0,
  price_per_sqft NUMERIC NOT NULL DEFAULT 0,
  historical_growth_pct NUMERIC NOT NULL DEFAULT 0,
  ai_estimated_value NUMERIC NOT NULL DEFAULT 0,
  price_difference_pct NUMERIC NOT NULL DEFAULT 0,
  development_rating NUMERIC NOT NULL DEFAULT 0,
  development_trend TEXT NOT NULL DEFAULT 'Stable',
  future_estimated_price NUMERIC NOT NULL DEFAULT 0,
  agent_score NUMERIC NOT NULL DEFAULT 0,
  investment_score NUMERIC NOT NULL DEFAULT 40,
  recommendation TEXT NOT NULL DEFAULT 'NEGOTIATE',
  property_rank INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_properties_location ON properties(location);
CREATE INDEX IF NOT EXISTS idx_properties_score ON properties(investment_score DESC);

CREATE TABLE IF NOT EXISTS user_inquiries (
  id BIGSERIAL PRIMARY KEY,
  property_id TEXT REFERENCES properties(property_id) ON DELETE SET NULL,
  user_name TEXT NOT NULL,
  user_email TEXT NOT NULL,
  user_phone TEXT,
  message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_inquiries_created_at ON user_inquiries(created_at DESC);

CREATE TABLE IF NOT EXISTS property_documents (
  id BIGSERIAL PRIMARY KEY,
  property_id TEXT REFERENCES properties(property_id) ON DELETE CASCADE,
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime_type TEXT,
  path TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ===== Site-visit booking + token payment (simulated) =====
CREATE TABLE IF NOT EXISTS visit_bookings (
  id BIGSERIAL PRIMARY KEY,
  booking_ref TEXT UNIQUE NOT NULL,
  property_id TEXT REFERENCES properties(property_id) ON DELETE SET NULL,
  property_name TEXT,
  slot_start TIMESTAMPTZ NOT NULL,
  buyer_name TEXT NOT NULL,
  buyer_email TEXT NOT NULL,
  buyer_phone TEXT NOT NULL,
  token_amount NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'PENDING_PAYMENT',   -- PENDING_PAYMENT | CONFIRMED | COMPLETED | CANCELLED | EXPIRED
  payment_status TEXT NOT NULL DEFAULT 'UNPAID',    -- UNPAID | PAID | REFUNDED
  payment_ref TEXT,
  paid_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bookings_slot ON visit_bookings(property_id, slot_start);
CREATE INDEX IF NOT EXISTS idx_bookings_created ON visit_bookings(created_at DESC);

CREATE TABLE IF NOT EXISTS payments (
  id BIGSERIAL PRIMARY KEY,
  booking_id BIGINT REFERENCES visit_bookings(id) ON DELETE CASCADE,
  amount NUMERIC NOT NULL,
  method TEXT NOT NULL,                              -- UPI | CARD | NETBANKING | REFUND
  status TEXT NOT NULL,                              -- SUCCESS | FAILED | REFUNDED
  txn_ref TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
