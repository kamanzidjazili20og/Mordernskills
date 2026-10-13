const fs = require('fs');
const path = require('path');
const { supabase } = require('../config/db');

// Checkout plans. The admin edits these from the panel (stored in
// public.payment_plans), but the checkout must never break if the table is
// missing or empty — so these mirror the original hard-coded values and are
// used as the per-tier fallback. Keep them in sync with the seed in
// supabase/Schrema.sql.
const DEFAULT_PLANS = [
    { accessType: 'video',   price: 500,  durationDays: null },
    { accessType: 'weekly',  price: 2000, durationDays: 7 },
    { accessType: 'monthly', price: 7000, durationDays: 30 }
];

const ACCESS_TYPES = ['video', 'weekly', 'monthly'];

// Offline fallback store. When a deployment has not yet re-run
// supabase/Schrema.sql, the payment_plans table does not exist and every
// admin save would fail with "Could not update the plan". We persist plan
// edits to a local JSON file in that case so the Plans & Prices panel keeps
// working; once the table exists the database becomes the source of truth.
const DATA_DIR = path.join(__dirname, '..', 'data');
const PLANS_FILE = path.join(DATA_DIR, 'plans.json');

function defaultMap() {
    const map = {};
    DEFAULT_PLANS.forEach(p => { map[p.accessType] = { ...p }; });
    return map;
}

function readFilePlans() {
    try {
        if (!fs.existsSync(PLANS_FILE)) return null;
        const raw = JSON.parse(fs.readFileSync(PLANS_FILE, 'utf8'));
        return raw && typeof raw === 'object' ? raw : null;
    } catch (err) {
        console.warn('  plans fallback file unreadable (' + (err.message || err) + ')');
        return null;
    }
}

function writeFilePlans(map) {
    try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(PLANS_FILE, JSON.stringify(map, null, 2), 'utf8');
        return true;
    } catch (err) {
        console.warn('  could not persist plans fallback file (' + (err.message || err) + ')');
        return false;
    }
}

function mapToArray(map) {
    return ACCESS_TYPES.map(t => map[t] || defaultMap()[t]);
}

async function plansFromDb() {
    const map = defaultMap();
    const { data, error } = await supabase
        .from('payment_plans')
        .select('access_type,price,duration_days');
    if (error) throw error;
    (data || []).forEach(row => {
        if (!map[row.access_type]) return;
        map[row.access_type] = {
            accessType: row.access_type,
            price: Number(row.price) || 0,
            durationDays: row.duration_days == null ? null : Number(row.duration_days)
        };
    });
    return map;
}

// Returns [video, weekly, monthly] with whatever the admin has configured,
// falling back to the defaults for any tier that is unavailable.
async function getPlans() {
    try {
        return mapToArray(await plansFromDb());
    } catch (err) {
        console.warn('  payment_plans unavailable — using fallback plans (' + (err.message || err) + ')');
    }
    const fileMap = readFilePlans();
    if (fileMap) return mapToArray(fileMap);
    return mapToArray(defaultMap());
}

async function getPlan(accessType) {
    if (!ACCESS_TYPES.includes(accessType)) return null;
    const plans = await getPlans();
    return plans.find(p => p.accessType === accessType) || null;
}

// Persist a plan edit. Prefers the payment_plans table; when the table is
// missing (schema not re-applied yet) it saves to the local fallback file so
// the admin panel always succeeds. Returns the plan that is now in effect.
async function savePlan(accessType, fields) {
    const current = await getPlan(accessType)
        || defaultMap()[accessType];

    const next = {
        accessType,
        price: fields.price !== undefined ? fields.price : current.price,
        durationDays: accessType === 'video' ? null
            : (fields.durationDays !== undefined ? fields.durationDays : current.durationDays)
    };

    try {
        const { error } = await supabase
            .from('payment_plans')
            .upsert({
                access_type: accessType,
                price: next.price,
                duration_days: next.durationDays,
                updated_at: new Date().toISOString()
            }, { onConflict: 'access_type' });
        if (error) throw error;
        // Keep the fallback file in sync in case the table later disappears.
        const fileMap = readFilePlans() || defaultMap();
        fileMap[accessType] = { ...next };
        writeFilePlans(fileMap);
        return { plan: next, source: 'database' };
    } catch (err) {
        console.warn('  payment_plans write failed — falling back to local file (' + (err.message || err) + ')');
        const fileMap = readFilePlans() || defaultMap();
        fileMap[accessType] = { ...next };
        if (!writeFilePlans(fileMap)) throw err;
        return { plan: next, source: 'file' };
    }
}

module.exports = { DEFAULT_PLANS, ACCESS_TYPES, getPlans, getPlan, savePlan };