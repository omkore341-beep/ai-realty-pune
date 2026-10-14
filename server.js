const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parse } = require('csv-parse/sync');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(ROOT, 'uploads'));
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/airealty' });
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';
const adminHashPromise = bcrypt.hash(ADMIN_PASSWORD, 10);

const localityCoords = {
  Baner:[18.5590,73.7868], Wakad:[18.5986,73.7636], Hinjewadi:[18.5912,73.7389],
  Bavdhan:[18.5186,73.7780], Kothrud:[18.5074,73.8077], 'Koregaon Park':[18.5362,73.8939],
  Shivajinagar:[18.5308,73.8470], Wagholi:[18.5793,73.9908], Pimpri:[18.6298,73.7997],
  Katraj:[18.4529,73.8652], Mulshi:[18.5111,73.5060], Pirangut:[18.5074,73.6820]
};
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
const documentTypes = [
  'RERA','Occupancy Certificate (OC)','Commencement Certificate (CC)','7/12 Extract / Property Card',
  'Index-II','Previous Sale Deed / Title Chain','Encumbrance Certificate','Sanctioned Building Plan',
  'Fire NOC','Environment NOC','AAI Height Clearance'
];
const metrics = JSON.parse(fs.readFileSync(path.join(ROOT,'data','model-metrics.json'),'utf8'));

app.use(express.json({limit:'2mb'}));
app.use(express.urlencoded({extended:true}));
app.use(session({
  store: new PgSession({ pool, tableName:'user_sessions', createTableIfMissing:true }),
  secret: SESSION_SECRET, resave:false, saveUninitialized:false,
  cookie:{httpOnly:true,sameSite:'lax',maxAge:1000*60*60*8}
}));
app.use(express.static(path.join(ROOT,'public')));

function moneyNumber(v){ return Number(v)||0; }
function scoreFromInputs({demand=5,growth=5,age=5,priceDiff=0}){
  // Mirrors the notebook's normalized 40–98.5 scoring concept for newly created records.
  const ng = Math.max(0,Math.min(1,(growth-0)/(10||1)));
  const nd = Math.max(0,Math.min(1,(demand-0)/(10||1)));
  const na = Math.max(0,Math.min(1,1-age/50));
  return Math.max(40,Math.min(98.5,Math.round((40+ng*25+nd*20+na*15-priceDiff*0.3)*10)/10));
}
function recommendation(score){ return score>=80?'BUY NOW':score>=65?'BUY / HOLD':'NEGOTIATE'; }
function rowToJson(r){
  const o={...r};
  for(const k of Object.keys(o)){
    if(['bhk','area_sqft','bathrooms','parking_spaces','age_years','metro_distance_km','it_park_distance_km','mall_distance_km','school_distance_km','hospital_distance_km','traffic_index','greenery_index','security_score','balconies','amenities_score','gym','swimming_pool','clubhouse','lift','price_2022','price_2023','price_2024','price_2025','current_price','demand_index','supply_index','infrastructure_growth_score','future_growth_score','rental_demand_score','upcoming_metro_impact','expected_short_term_growth_pct','road_connectivity_score','commercial_development','residential_development','price_per_sqft','historical_growth_pct','ai_estimated_value','price_difference_pct','development_rating','future_estimated_price','agent_score','investment_score','property_rank'].includes(k)) o[k]=Number(o[k]);
  }
  return o;
}
async function initDb(){
  const schema=fs.readFileSync(path.join(ROOT,'schema.sql'),'utf8');
  await pool.query(schema);
  const {rows:[count]}=await pool.query('SELECT COUNT(*)::int AS count FROM properties');
  if(count.count===0){
    const csv=fs.readFileSync(path.join(ROOT,'data','properties.csv'),'utf8');
    const rows=parse(csv,{columns:true,skip_empty_lines:true});
    const headers=Object.keys(rows[0]); const cols=headers.map(h=>HEADER_MAP[h]);
    const numeric=new Set(cols.filter(c=>!['property_id','property_name','location','property_type','listing_type','furnishing','development_trend','recommendation'].includes(c)));
    for(const row of rows){
      const vals=headers.map(h=>numeric.has(HEADER_MAP[h]) ? Number(row[h])||0 : row[h]);
      const ph=cols.map((_,i)=>`$${i+1}`).join(',');
      await pool.query(`INSERT INTO properties (${cols.join(',')}) VALUES (${ph})`,vals);
    }
    console.log(`Database seeded with ${rows.length} properties.`);
  }
}

function adminOnly(req,res,next){
  if(!req.session.admin) return res.status(401).json({error:'Admin authentication required'});
  next();
}

const storage=multer.diskStorage({
  destination:(req,file,cb)=>{ const dir=path.join(UPLOAD_DIR,String(req.params.id)); fs.mkdirSync(dir,{recursive:true}); cb(null,dir); },
  filename:(req,file,cb)=>{ const safe=path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g,'_'); cb(null,Date.now()+'-'+safe); }
});
const upload=multer({storage,limits:{fileSize:200*1024*1024}});

app.get('/api/config',(req,res)=>res.json({localityCoords,documentTypes,metrics,admin:!!req.session.admin}));

app.get('/api/properties',async(req,res)=>{
  try{
    const {location,bhk,type,listing,furnishing,maxPrice,minPrice,sort='investment_score',dir='desc',q}=req.query;
    const where=[],params=[];
    const add=(sql,v)=>{params.push(v);where.push(`${sql} $${params.length}`)};
    if(location) add(`location =`,location);
    if(bhk) add(`bhk =`,Number(bhk));
    if(type) add(`property_type =`,type);
    if(listing) add(`listing_type =`,listing);
    if(furnishing) add(`furnishing =`,furnishing);
    if(maxPrice) add(`current_price <=`,Number(maxPrice));
    if(minPrice) add(`current_price >=`,Number(minPrice));
    if(q){params.push(`%${q}%`);where.push(`(property_name ILIKE $${params.length} OR property_id ILIKE $${params.length} OR location ILIKE $${params.length})`);}
    const allowed=['investment_score','current_price','property_rank','area_sqft','expected_short_term_growth_pct'];
    const order=allowed.includes(sort)?sort:'investment_score';
    const direction=String(dir).toLowerCase()==='asc'?'ASC':'DESC';
    const sql=`SELECT * FROM properties ${where.length?'WHERE '+where.join(' AND '):''} ORDER BY ${order} ${direction}`;
    const {rows}=await pool.query(sql,params);
    res.json(rows.map(rowToJson));
  }catch(e){res.status(500).json({error:e.message})}
});
app.get('/api/properties/:id',async(req,res)=>{
  try{const {rows}=await pool.query('SELECT * FROM properties WHERE property_id=$1',[req.params.id]); if(!rows[0])return res.status(404).json({error:'Property not found'}); res.json(rowToJson(rows[0]));}
  catch(e){res.status(500).json({error:e.message})}
});
app.post('/api/inquiries',async(req,res)=>{
  const {propertyId,name,email,phone,message}=req.body;
  if(!name||!email||!propertyId)return res.status(400).json({error:'Property, name and email are required.'});
  try{await pool.query('INSERT INTO user_inquiries(property_id,user_name,user_email,user_phone,message) VALUES($1,$2,$3,$4,$5)',[propertyId,name,email,phone||'',message||'']);res.json({ok:true});}
  catch(e){res.status(500).json({error:e.message})}
});
app.get('/api/market',async(req,res)=>{
  try{
    const [summary,locality,recommendations]=await Promise.all([
      pool.query('SELECT COUNT(*)::int properties, COUNT(DISTINCT location)::int localities, AVG(current_price)::numeric avg_price, AVG(ai_estimated_value)::numeric avg_ai FROM properties'),
      pool.query('SELECT location, COUNT(*)::int count, AVG(current_price)::numeric avg_price, AVG(investment_score)::numeric avg_score FROM properties GROUP BY location ORDER BY count DESC'),
      pool.query('SELECT property_rank,property_id,property_name,location,bhk,current_price,ai_estimated_value,investment_score,recommendation FROM properties ORDER BY investment_score DESC LIMIT 10')
    ]);
    res.json({summary:summary.rows[0],locality:locality.rows,recommendations:recommendations.rows.map(rowToJson)});
  }catch(e){res.status(500).json({error:e.message})}
});
app.get('/api/properties/:id/documents',async(req,res)=>{
  try{const {rows}=await pool.query('SELECT id,original_name,mime_type,created_at FROM property_documents WHERE property_id=$1 ORDER BY created_at DESC',[req.params.id]);res.json({documents:rows,types:documentTypes});}
  catch(e){res.status(500).json({error:e.message})}
});
app.post('/api/properties/:id/documents',upload.array('documents',20),async(req,res)=>{
  try{
    const {rows:p}=await pool.query('SELECT 1 FROM properties WHERE property_id=$1',[req.params.id]); if(!p[0]) return res.status(404).json({error:'Property not found'});
    for(const f of (req.files||[])) await pool.query('INSERT INTO property_documents(property_id,original_name,stored_name,mime_type,path) VALUES($1,$2,$3,$4,$5)',[req.params.id,f.originalname,f.filename,f.mimetype,f.path]);
    res.json({ok:true,count:(req.files||[]).length});
  }catch(e){res.status(500).json({error:e.message})}
});
app.post('/api/documents/check',async(req,res)=>{
  const {propertyId,documentPropertyId,documentLocation,documentArea,documentPrice}=req.body;
  try{
    const {rows}=await pool.query('SELECT * FROM properties WHERE property_id=$1',[propertyId]); if(!rows[0])return res.status(404).json({error:'Property not found'});
    const r=rows[0], flags=[];
    if(String(documentPropertyId).trim()!==String(r.property_id).trim()) flags.push({severity:'HIGH',title:'Property ID mismatch',description:`Dataset ID is ${r.property_id} but document says ${documentPropertyId}.`});
    if(String(documentLocation).trim().toLowerCase()!==String(r.location).trim().toLowerCase()) flags.push({severity:'MEDIUM',title:'Location mismatch',description:`Dataset location is ${r.location} but document says ${documentLocation}.`});
    if(Math.abs(Number(documentArea)-Number(r.area_sqft))>Math.max(25,Number(r.area_sqft)*.03)) flags.push({severity:'HIGH',title:'Area mismatch',description:`Dataset area is ${Number(r.area_sqft).toFixed(0)} sq ft but document says ${Number(documentArea).toFixed(0)} sq ft.`});
    if(Math.abs(Number(documentPrice)-Number(r.current_price))>Math.max(100000,Number(r.current_price)*.05)) flags.push({severity:'MEDIUM',title:'Price mismatch',description:`Dataset price is ₹${Number(r.current_price).toLocaleString('en-IN')} but document says ₹${Number(documentPrice).toLocaleString('en-IN')}.`});
    if(!flags.length) flags.push({severity:'LOW',title:'No mismatch found in supplied fields',description:'The supplied property ID, location, area and price are consistent with the dataset.'});
    res.json(flags);
  }catch(e){res.status(500).json({error:e.message})}
});
app.post('/api/admin/login',async(req,res)=>{
  const {password}=req.body; const hash=await adminHashPromise;
  if(password && await bcrypt.compare(password,hash)){req.session.admin=true; return res.json({ok:true});}
  res.status(401).json({error:'Invalid admin password'});
});
app.post('/api/admin/logout',(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get('/api/admin/status',(req,res)=>res.json({admin:!!req.session.admin}));

app.get('/api/admin/inquiries',adminOnly,async(req,res)=>{
  try{const {rows}=await pool.query(`SELECT i.id,i.property_id,i.user_name,i.user_email,i.user_phone,i.message,i.created_at,p.property_name,p.location,p.current_price FROM user_inquiries i LEFT JOIN properties p ON p.property_id=i.property_id ORDER BY i.created_at DESC`);res.json(rows);}
  catch(e){res.status(500).json({error:e.message})}
});
app.get('/api/admin/analytics',adminOnly,async(req,res)=>{
  try{
    const [loc,type,counts]=await Promise.all([
      pool.query(`SELECT p.location,COUNT(*)::int inquiry_count,AVG(p.current_price)::numeric avg_price FROM user_inquiries i JOIN properties p ON i.property_id=p.property_id GROUP BY p.location ORDER BY inquiry_count DESC`),
      pool.query(`SELECT p.property_type,COUNT(i.id)::int total_inquiries,AVG(p.current_price)::numeric average_price FROM user_inquiries i JOIN properties p ON i.property_id=p.property_id GROUP BY p.property_type ORDER BY total_inquiries DESC`),
      pool.query(`SELECT (SELECT COUNT(*) FROM properties)::int properties,(SELECT COUNT(*) FROM user_inquiries)::int inquiries`)
    ]);
    res.json({byLocality:loc.rows,byType:type.rows,counts:counts.rows[0]});
  }catch(e){res.status(500).json({error:e.message})}
});
app.get('/api/admin/properties',adminOnly,async(req,res)=>{
  const {rows}=await pool.query('SELECT * FROM properties ORDER BY property_rank ASC,property_id ASC');res.json(rows.map(rowToJson));
});
app.post('/api/admin/properties',adminOnly,async(req,res)=>{
  try{
    const b=req.body; if(!b.propertyId||!b.propertyName||!b.location) return res.status(400).json({error:'Property ID, name and locality are required.'});
    const current=moneyNumber(b.currentPrice), ai=current;
    const score=scoreFromInputs({demand:moneyNumber(b.demandIndex)||5,growth:moneyNumber(b.futureGrowthScore)||5,age:moneyNumber(b.ageYears)||5,priceDiff:0});
    const rec=recommendation(score);
    await pool.query(`INSERT INTO properties(property_id,property_name,location,property_type,listing_type,bhk,area_sqft,bathrooms,parking_spaces,age_years,furnishing,current_price,price_per_sqft,ai_estimated_value,investment_score,recommendation,property_rank,demand_index,future_growth_score,rental_demand_score,expected_short_term_growth_pct) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,(SELECT COALESCE(MAX(property_rank),0)+1 FROM properties),$17,$18,$19,$20)`,
      [b.propertyId,b.propertyName,b.location,b.propertyType||'Apartment',b.listingType||'Resale',Number(b.bhk)||1,Number(b.areaSqft)||0,Number(b.bathrooms)||1,Number(b.parkingSpaces)||0,Number(b.ageYears)||0,b.furnishing||'Unfurnished',current,Number(b.areaSqft)?current/Number(b.areaSqft):0,ai,score,rec,Number(b.demandIndex)||5,Number(b.futureGrowthScore)||5,Number(b.rentalDemandScore)||5,Number(b.expectedGrowth)||5]);
    res.json({ok:true});
  }catch(e){res.status(400).json({error:e.message})}
});
app.put('/api/admin/properties/:id',adminOnly,async(req,res)=>{
  try{
    const b=req.body; const current=moneyNumber(b.currentPrice), score=scoreFromInputs({demand:moneyNumber(b.demandIndex)||5,growth:moneyNumber(b.futureGrowthScore)||5,age:moneyNumber(b.ageYears)||5,priceDiff:0});
    await pool.query(`UPDATE properties SET property_name=$1,location=$2,property_type=$3,listing_type=$4,bhk=$5,area_sqft=$6,bathrooms=$7,parking_spaces=$8,age_years=$9,furnishing=$10,current_price=$11,price_per_sqft=$12,ai_estimated_value=$13,investment_score=$14,recommendation=$15,demand_index=$16,future_growth_score=$17,rental_demand_score=$18,expected_short_term_growth_pct=$19,updated_at=NOW() WHERE property_id=$20`,
      [b.propertyName,b.location,b.propertyType||'Apartment',b.listingType||'Resale',Number(b.bhk)||1,Number(b.areaSqft)||0,Number(b.bathrooms)||1,Number(b.parkingSpaces)||0,Number(b.ageYears)||0,b.furnishing||'Unfurnished',current,Number(b.areaSqft)?current/Number(b.areaSqft):0,current,score,recommendation(score),Number(b.demandIndex)||5,Number(b.futureGrowthScore)||5,Number(b.rentalDemandScore)||5,Number(b.expectedGrowth)||5,req.params.id]);
    res.json({ok:true});
  }catch(e){res.status(400).json({error:e.message})}
});
app.delete('/api/admin/properties/:id',adminOnly,async(req,res)=>{
  try{await pool.query('DELETE FROM properties WHERE property_id=$1',[req.params.id]);res.json({ok:true});}catch(e){res.status(500).json({error:e.message})}
});

// ===================== Site-visit booking + token payment (SIMULATED) =====================
// Slots are generated on the fly: fixed times, next 14 days, India time (IST, +05:30).
// To change times/days/token amount, edit the constants below.
const VISIT_TIMES = ['10:00','11:00','12:00','14:00','15:00','16:00','17:00'];
const VISIT_DAYS_AHEAD = 14;
const HOLD_MINUTES = 10;          // a slot is held this long while the buyer pays
const MIN_LEAD_MS = 60 * 60 * 1000; // slots must start at least 1 hour from now

// Token = 1% of price, at least Rs 10,000 and at most Rs 1,00,000 (rounded to nearest 100)
function tokenFor(price){
  const p = Number(price) || 0;
  return Math.round(Math.min(100000, Math.max(10000, p * 0.01)) / 100) * 100;
}
function istDays(n){
  const base = new Date(Date.now() + 330 * 60000); // IST wall-clock date, read via UTC fields
  const y = base.getUTCFullYear(), m = base.getUTCMonth(), d = base.getUTCDate();
  return Array.from({length:n}, (_, i) => new Date(Date.UTC(y, m, d + i)).toISOString().slice(0, 10));
}
const slotMs = (date, time) => new Date(`${date}T${time}:00+05:30`).getTime();
function publicBooking(b){
  return {
    booking_ref:b.booking_ref, property_id:b.property_id, property_name:b.property_name, slot_start:b.slot_start,
    buyer_name:b.buyer_name, buyer_email:b.buyer_email, buyer_phone:b.buyer_phone, status:b.status,
    token_amount:Number(b.token_amount), payment_status:b.payment_status, payment_ref:b.payment_ref,
    paid_at:b.paid_at, expires_at:b.expires_at
  };
}
const expirePending = (db = pool) =>
  db.query(`UPDATE visit_bookings SET status='EXPIRED' WHERE status='PENDING_PAYMENT' AND expires_at<=NOW()`);

// Available slots for one property
app.get('/api/properties/:id/slots', async (req, res) => {
  try{
    const {rows:p} = await pool.query('SELECT property_id,current_price FROM properties WHERE property_id=$1', [req.params.id]);
    if(!p[0]) return res.status(404).json({error:'Property not found'});
    await expirePending();
    const {rows:taken} = await pool.query(
      `SELECT slot_start FROM visit_bookings WHERE property_id=$1 AND slot_start>=NOW() AND status IN ('PENDING_PAYMENT','CONFIRMED','COMPLETED')`,
      [req.params.id]);
    const takenSet = new Set(taken.map(r => new Date(r.slot_start).getTime()));
    const now = Date.now();
    const days = istDays(VISIT_DAYS_AHEAD).map(date => ({
      date,
      slots: VISIT_TIMES.map(time => {
        const ts = slotMs(date, time);
        return {time, iso:new Date(ts).toISOString(), available: ts > now + MIN_LEAD_MS && !takenSet.has(ts)};
      })
    }));
    res.json({tokenAmount:tokenFor(p[0].current_price), holdMinutes:HOLD_MINUTES, days});
  }catch(e){res.status(500).json({error:e.message})}
});

// Step 1: buyer picks a slot -> slot is held (PENDING_PAYMENT) for HOLD_MINUTES
app.post('/api/bookings', async (req, res) => {
  const {propertyId, slot, name, email, phone} = req.body || {};
  if(!propertyId || !slot || !name || !email || !phone) return res.status(400).json({error:'Please fill in your name, email and phone, and choose a time.'});
  if(!/^\S+@\S+\.\S+$/.test(String(email))) return res.status(400).json({error:'Please enter a valid email address.'});
  if(!/^[0-9+\-\s]{10,15}$/.test(String(phone))) return res.status(400).json({error:'Please enter a valid phone number.'});
  const ts = new Date(slot);
  if(isNaN(ts)) return res.status(400).json({error:'Invalid time selected.'});
  const onGrid = istDays(VISIT_DAYS_AHEAD).some(d => VISIT_TIMES.some(t => slotMs(d, t) === ts.getTime()));
  if(!onGrid || ts.getTime() <= Date.now() + MIN_LEAD_MS) return res.status(400).json({error:'This slot is not available. Please choose another slot.'});
  const client = await pool.connect();
  try{
    await client.query('BEGIN');
    // lock per property+slot so two buyers cannot book the same slot at the same moment
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [propertyId + '|' + ts.toISOString()]);
    const {rows:pr} = await client.query('SELECT property_id,property_name,current_price FROM properties WHERE property_id=$1', [propertyId]);
    if(!pr[0]){ await client.query('ROLLBACK'); return res.status(404).json({error:'Property not found'}); }
    await expirePending(client);
    const {rows:clash} = await client.query(
      `SELECT 1 FROM visit_bookings WHERE property_id=$1 AND slot_start=$2 AND status IN ('PENDING_PAYMENT','CONFIRMED','COMPLETED')`,
      [propertyId, ts.toISOString()]);
    if(clash[0]){ await client.query('ROLLBACK'); return res.status(409).json({error:'Sorry, this slot was just taken. Please pick another slot.'}); }
    const ref = 'AR-' + crypto.randomBytes(4).toString('hex').toUpperCase();
    const {rows:[b]} = await client.query(
      `INSERT INTO visit_bookings(booking_ref,property_id,property_name,slot_start,buyer_name,buyer_email,buyer_phone,token_amount,expires_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,NOW()+make_interval(mins=>$9)) RETURNING *`,
      [ref, propertyId, pr[0].property_name, ts.toISOString(), String(name).trim(), String(email).trim(), String(phone).trim(), tokenFor(pr[0].current_price), HOLD_MINUTES]);
    await client.query('COMMIT');
    res.json(publicBooking(b));
  }catch(e){
    try{ await client.query('ROLLBACK'); }catch(_){}
    res.status(500).json({error:e.message});
  }finally{ client.release(); }
});

// Look up a booking (needs the booking reference AND the email used)
app.get('/api/bookings/:ref', async (req, res) => {
  try{
    const {rows} = await pool.query('SELECT * FROM visit_bookings WHERE booking_ref=$1', [req.params.ref]);
    const b = rows[0];
    if(!b || b.buyer_email.toLowerCase() !== String(req.query.email || '').toLowerCase()) return res.status(404).json({error:'Booking not found'});
    res.json(publicBooking(b));
  }catch(e){res.status(500).json({error:e.message})}
});

// Step 2: SIMULATED token payment. No card data is stored - only the method and a fake transaction id.
app.post('/api/bookings/:ref/pay', async (req, res) => {
  const {email, method, last4} = req.body || {};
  if(!['CARD','UPI','NETBANKING'].includes(method)) return res.status(400).json({error:'Choose a payment method.'});
  const client = await pool.connect();
  try{
    await client.query('BEGIN');
    const {rows:[b]} = await client.query('SELECT * FROM visit_bookings WHERE booking_ref=$1 FOR UPDATE', [req.params.ref]);
    if(!b || b.buyer_email.toLowerCase() !== String(email || '').toLowerCase()){ await client.query('ROLLBACK'); return res.status(404).json({error:'Booking not found'}); }
    if(b.payment_status === 'PAID'){ await client.query('ROLLBACK'); return res.json(publicBooking(b)); } // already paid, safe to retry
    if(b.status !== 'PENDING_PAYMENT' || new Date(b.expires_at) <= new Date()){
      await client.query(`UPDATE visit_bookings SET status='EXPIRED' WHERE id=$1 AND status='PENDING_PAYMENT'`, [b.id]);
      await client.query('COMMIT');
      return res.status(410).json({error:'Your slot hold has expired. Please pick a slot again.'});
    }
    if(String(last4 || '') === '0000'){ // demo: card ending 0000 = declined
      await client.query(`INSERT INTO payments(booking_id,amount,method,status,txn_ref) VALUES($1,$2,$3,'FAILED',$4)`,
        [b.id, b.token_amount, method, 'TXN' + Date.now()]);
      await client.query('COMMIT');
      return res.status(402).json({error:'Payment declined (demo: card ending 0000 always fails). Try another card or UPI.'});
    }
    const txn = 'TXN' + Date.now() + crypto.randomInt(100, 999);
    await client.query(`INSERT INTO payments(booking_id,amount,method,status,txn_ref) VALUES($1,$2,$3,'SUCCESS',$4)`, [b.id, b.token_amount, method, txn]);
    const {rows:[done]} = await client.query(
      `UPDATE visit_bookings SET status='CONFIRMED',payment_status='PAID',payment_ref=$1,paid_at=NOW() WHERE id=$2 RETURNING *`, [txn, b.id]);
    await client.query('COMMIT');
    res.json(publicBooking(done));
  }catch(e){
    try{ await client.query('ROLLBACK'); }catch(_){}
    res.status(500).json({error:e.message});
  }finally{ client.release(); }
});

// Buyer changes their mind before paying -> free the held slot
app.post('/api/bookings/:ref/release', async (req, res) => {
  try{
    await pool.query(
      `UPDATE visit_bookings SET status='CANCELLED' WHERE booking_ref=$1 AND lower(buyer_email)=lower($2) AND status='PENDING_PAYMENT'`,
      [req.params.ref, String(req.body?.email || '')]);
    res.json({ok:true});
  }catch(e){res.status(500).json({error:e.message})}
});

// ---- Admin: see bookings + payments, complete or cancel (cancel on a paid booking = simulated refund) ----
app.get('/api/admin/bookings', adminOnly, async (req, res) => {
  try{
    await expirePending();
    const {rows} = await pool.query(
      `SELECT b.*, p.location FROM visit_bookings b LEFT JOIN properties p ON p.property_id=b.property_id ORDER BY b.slot_start DESC LIMIT 300`);
    const {rows:[stats]} = await pool.query(
      `SELECT COUNT(*)::int total,
              COUNT(*) FILTER (WHERE status='CONFIRMED')::int confirmed,
              COUNT(*) FILTER (WHERE status='PENDING_PAYMENT')::int pending,
              COALESCE(SUM(token_amount) FILTER (WHERE payment_status='PAID'),0)::numeric collected
       FROM visit_bookings`);
    res.json({bookings:rows.map(r => ({...publicBooking(r), id:r.id, location:r.location, created_at:r.created_at})), stats:{...stats, collected:Number(stats.collected)}});
  }catch(e){res.status(500).json({error:e.message})}
});
app.put('/api/admin/bookings/:id/status', adminOnly, async (req, res) => {
  const {status} = req.body || {};
  if(!['COMPLETED','CANCELLED'].includes(status)) return res.status(400).json({error:'Invalid status'});
  if(!/^\d+$/.test(req.params.id)) return res.status(400).json({error:'Invalid booking id'});
  const client = await pool.connect();
  try{
    await client.query('BEGIN');
    const {rows:[b]} = await client.query('SELECT * FROM visit_bookings WHERE id=$1 FOR UPDATE', [req.params.id]);
    if(!b){ await client.query('ROLLBACK'); return res.status(404).json({error:'Booking not found'}); }
    if(['CANCELLED','EXPIRED','COMPLETED'].includes(b.status)){ await client.query('ROLLBACK'); return res.status(409).json({error:'This booking is already closed.'}); }
    if(status === 'COMPLETED' && b.status !== 'CONFIRMED'){ await client.query('ROLLBACK'); return res.status(409).json({error:'Only confirmed visits can be marked completed.'}); }
    let refunded = false;
    if(status === 'CANCELLED' && b.payment_status === 'PAID'){
      await client.query(`INSERT INTO payments(booking_id,amount,method,status,txn_ref) VALUES($1,$2,'REFUND','REFUNDED',$3)`,
        [b.id, b.token_amount, 'RFD' + Date.now()]);
      await client.query(`UPDATE visit_bookings SET payment_status='REFUNDED' WHERE id=$1`, [b.id]);
      refunded = true;
    }
    await client.query('UPDATE visit_bookings SET status=$1 WHERE id=$2', [status, b.id]);
    await client.query('COMMIT');
    res.json({ok:true, refunded});
  }catch(e){
    try{ await client.query('ROLLBACK'); }catch(_){}
    res.status(500).json({error:e.message});
  }finally{ client.release(); }
});
// =========================================================================================

app.get('*',(req,res)=>res.sendFile(path.join(ROOT,'public','index.html')));

initDb().then(()=>app.listen(PORT,()=>console.log(`AI Realty running at http://localhost:${PORT}`))).catch(e=>{console.error('Database startup failed:',e);process.exit(1)});
