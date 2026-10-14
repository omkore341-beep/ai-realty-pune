const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { parse } = require('csv-parse/sync');

const pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/airealty' });

const HEADER_MAP = {
  "PropertyID": "property_id",
  "PropertyName": "property_name",
  "Location": "location",
  "PropertyType": "property_type",
  "ListingType": "listing_type",
  "BHK": "bhk",
  "AreaSqFt": "area_sqft",
  "Bathrooms": "bathrooms",
  "ParkingSpaces": "parking_spaces",
  "AgeYears": "age_years",
  "MetroDistanceKm": "metro_distance_km",
  "ITParkDistanceKm": "it_park_distance_km",
  "MallDistanceKm": "mall_distance_km",
  "SchoolDistanceKm": "school_distance_km",
  "HospitalDistanceKm": "hospital_distance_km",
  "TrafficIndex": "traffic_index",
  "GreeneryIndex": "greenery_index",
  "SecurityScore": "security_score",
  "Furnishing": "furnishing",
  "Balconies": "balconies",
  "AmenitiesScore": "amenities_score",
  "Gym": "gym",
  "SwimmingPool": "swimming_pool",
  "Clubhouse": "clubhouse",
  "Lift": "lift",
  "Price2022": "price_2022",
  "Price2023": "price_2023",
  "Price2024": "price_2024",
  "Price2025": "price_2025",
  "CurrentPrice": "current_price",
  "DemandIndex": "demand_index",
  "SupplyIndex": "supply_index",
  "InfrastructureGrowthScore": "infrastructure_growth_score",
  "FutureGrowthScore": "future_growth_score",
  "RentalDemandScore": "rental_demand_score",
  "UpcomingMetroImpact": "upcoming_metro_impact",
  "ExpectedShortTermGrowthPct": "expected_short_term_growth_pct",
  "RoadConnectivityScore": "road_connectivity_score",
  "CommercialDevelopment": "commercial_development",
  "ResidentialDevelopment": "residential_development",
  "PricePerSqFt": "price_per_sqft",
  "HistoricalGrowthPct": "historical_growth_pct",
  "AI_EstimatedValue": "ai_estimated_value",
  "PriceDifferencePct": "price_difference_pct",
  "DevelopmentRating": "development_rating",
  "DevelopmentTrend": "development_trend",
  "FutureEstimatedPrice": "future_estimated_price",
  "AgentScore": "agent_score",
  "Recommendation": "recommendation",
  "PropertyRank": "property_rank",
  "InvestmentScore": "investment_score"
};
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }

async function main() {
  const client = await pool.connect();
  try {
    const schema = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
    await client.query(schema);
    const csv = fs.readFileSync(path.join(__dirname, '..', 'data', 'properties.csv'), 'utf8');
    const rows = parse(csv, { columns: true, skip_empty_lines: true });
    const columns = Object.keys(rows[0]).map(h=>HEADER_MAP[h]);
    const tableCols = columns.map(c => c === 'property_id' ? 'property_id' : c);
    const placeholders = tableCols.map((_, i) => `$${i + 1}`).join(',');
    await client.query('BEGIN');
    await client.query('TRUNCATE properties RESTART IDENTITY CASCADE');
    for (const row of rows) {
      const values = Object.keys(row).map((h) => {
        const c = HEADER_MAP[h];
        const value = row[h];
        const numeric = new Set([
          'bhk','area_sqft','bathrooms','parking_spaces','age_years','metro_distance_km','it_park_distance_km',
          'mall_distance_km','school_distance_km','hospital_distance_km','traffic_index','greenery_index',
          'security_score','balconies','amenities_score','gym','swimming_pool','clubhouse','lift','price_2022',
          'price_2023','price_2024','price_2025','current_price','demand_index','supply_index',
          'infrastructure_growth_score','future_growth_score','rental_demand_score','upcoming_metro_impact',
          'expected_short_term_growth_pct','road_connectivity_score','commercial_development','residential_development',
          'price_per_sqft','historical_growth_pct','ai_estimated_value','price_difference_pct','development_rating',
          'future_estimated_price','agent_score','investment_score','property_rank'
        ]);
        return numeric.has(c) ? num(value) : value;
      });
      await client.query(
        `INSERT INTO properties (${tableCols.join(',')}) VALUES (${placeholders})
         ON CONFLICT (property_id) DO UPDATE SET ${tableCols.filter(c=>c!=='property_id').map(c=>`${c}=EXCLUDED.${c}`).join(',')}`,
        values
      );
    }
    await client.query('COMMIT');
    console.log(`Seeded ${rows.length} properties.`);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}
main();
