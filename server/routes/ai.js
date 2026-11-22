import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { allowRoles, requireAuth } from '../middleware/auth.js';
import { config } from '../config.js';
import { User } from '../models/User.js';
import { Offer } from '../models/Offer.js';

const router = Router();
const categories = ['produce', 'prepared-meals', 'bakery', 'other'];
const clean = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const listingDraftLimit = rateLimit({ windowMs: 60_000, limit: 8, standardHeaders: 'draft-8', legacyHeaders: false });
const adminInsightsLimit = rateLimit({ windowMs: 60_000, limit: 12, standardHeaders: 'draft-8', legacyHeaders: false });
const insightKeys = [
  'customerAccounts', 'restaurantAccounts', 'pendingRestaurantApplications', 'needsInfoRestaurantApplications',
  'activeRestaurants', 'suspendedRestaurants', 'availableOffers', 'pickupsAwaitingCollection',
  'completedPickups', 'closedOffers', 'totalOffers'
];

async function callGemini(instructions, input, responseSchema, maxOutputTokens = 350) {
  if (!config.geminiApiKey) throw Object.assign(new Error('Gemini is not configured. Add GEMINI_API_KEY to the server .env file.'), { status: 503 });
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.geminiModel)}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': config.geminiApiKey, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(60_000),
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: instructions }] },
      contents: [{ role: 'user', parts: [{ text: input }] }],
      generationConfig: { maxOutputTokens, responseMimeType: 'application/json', responseSchema }
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error('Gemini request failed:', response.status, payload.error?.status || 'provider_error');
    throw Object.assign(new Error('Gemini could not complete the request. Check the API key, model access, and quota.'), { status: 502 });
  }
  const output = (payload.candidates?.[0]?.content?.parts || []).map(item => item.text || '').join('\n').trim();
  return JSON.parse(output);
}

function handleGeminiError(error, res, label) {
  if (error.status) return res.status(error.status).json({ error: error.message });
  if (error.name === 'TimeoutError' || error.name === 'AbortError') return res.status(504).json({ error: 'The AI request took too long. Please try again.' });
  console.error(`${label} response could not be used:`, error.message);
  return res.status(502).json({ error: 'The Gemini response could not be used. Please try again.' });
}

router.post('/listing-draft', requireAuth, allowRoles('restaurant'), listingDraftLimit, async (req, res) => {
  const { title, category, quantity, neighborhood, description, handlingNotes } = req.body || {};
  const source = {
    title: clean(title, 120),
    category: categories.includes(category) ? category : 'other',
    quantity: clean(quantity, 120),
    neighborhood: clean(neighborhood, 120),
    description: clean(description, 1000),
    handlingNotes: clean(handlingNotes, 1000)
  };
  if (![source.title, source.description, source.handlingNotes].some(Boolean)) {
    return res.status(400).json({ error: 'Enter a rough title or some offer details before asking for a draft.' });
  }

  try {
    const draft = await callGemini(
      'You write concise, accurate surplus-food listing copy for Leftover Link. Use only facts present in the input. Never invent ingredients, allergens, food-safety claims, temperature, dates, or quantities. Do not change category, quantity, neighbourhood, or pickup details. Return only a JSON object with string fields title and description. The title should be clear and short. The description should be practical and no more than 60 words. If details are missing, leave them out.',
      JSON.stringify(source),
      {
        type: 'OBJECT',
        properties: { title: { type: 'STRING' }, description: { type: 'STRING' } },
        required: ['title', 'description'],
        propertyOrdering: ['title', 'description']
      }
    );
    const draftedTitle = clean(draft.title, 120);
    const draftedDescription = clean(draft.description, 1000);
    if (!draftedTitle && !draftedDescription) throw new Error('Empty draft');
    return res.json({ title: draftedTitle || source.title, description: draftedDescription });
  } catch (error) {
    return handleGeminiError(error, res, 'Gemini listing draft');
  }
});

router.post('/admin-insights', requireAuth, allowRoles('administrator'), adminInsightsLimit, async (req, res) => {
  const question = clean(req.body?.question, 500);
  if (question.length < 3) return res.status(400).json({ error: 'Enter a question about your app data.' });

  try {
    const [customerAccounts, restaurantAccounts, pendingRestaurantApplications, needsInfoRestaurantApplications,
      activeRestaurants, suspendedRestaurants, offerGroups] = await Promise.all([
      User.countDocuments({ role: 'consumer' }),
      User.countDocuments({ role: 'restaurant' }),
      User.countDocuments({ role: 'restaurant', status: 'pending' }),
      User.countDocuments({ role: 'restaurant', status: 'needs-information' }),
      User.countDocuments({ role: 'restaurant', status: 'active' }),
      User.countDocuments({ role: 'restaurant', status: 'suspended' }),
      Offer.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }])
    ]);
    const offers = Object.fromEntries(offerGroups.map(group => [group._id, group.count]));
    const metrics = {
      customerAccounts,
      restaurantAccounts,
      pendingRestaurantApplications,
      needsInfoRestaurantApplications,
      activeRestaurants,
      suspendedRestaurants,
      availableOffers: offers.available || 0,
      pickupsAwaitingCollection: offers.claimed || 0,
      completedPickups: offers.collected || 0,
      closedOffers: offers.closed || 0,
      totalOffers: Object.values(offers).reduce((sum, count) => sum + count, 0)
    };

    const plan = await callGemini(
      `You are a database analytics question router for Leftover Link. Choose only metric keys that directly answer the administrator's question. Available metric keys: ${insightKeys.join(', ')}. The app tracks food offers and consumer pickup claims, not a separate order collection. Map a question about pending orders to pickupsAwaitingCollection and completed orders to completedPickups, and make the app's terminology clear in the final system-generated answer. The supplied metrics are current totals only; if a user asks for a specific date range, month, trend, or comparison over time, set unsupportedTimeRange true. For a general overview choose all keys. If unrelated or unclear, return no keys. Do not answer with facts or counts. Return only the requested JSON.`,
      JSON.stringify({ question }),
      {
        type: 'OBJECT',
        properties: {
          metricKeys: { type: 'ARRAY', items: { type: 'STRING', enum: insightKeys } },
          unsupportedTimeRange: { type: 'BOOLEAN' }
        },
        required: ['metricKeys', 'unsupportedTimeRange'],
        propertyOrdering: ['metricKeys', 'unsupportedTimeRange']
      },
      180
    );

    const selected = [...new Set(Array.isArray(plan.metricKeys) ? plan.metricKeys.filter(key => insightKeys.includes(key)) : [])];
    const labels = {
      customerAccounts: ['Customer accounts', metrics.customerAccounts],
      restaurantAccounts: ['Restaurant accounts', metrics.restaurantAccounts],
      pendingRestaurantApplications: ['Restaurant applications awaiting review', metrics.pendingRestaurantApplications],
      needsInfoRestaurantApplications: ['Restaurant applications needing more information', metrics.needsInfoRestaurantApplications],
      activeRestaurants: ['Active restaurants', metrics.activeRestaurants],
      suspendedRestaurants: ['Suspended restaurant accounts', metrics.suspendedRestaurants],
      availableOffers: ['Available food offers', metrics.availableOffers],
      pickupsAwaitingCollection: ['Pickups awaiting collection (claimed offers, or “pending orders” in order terminology)', metrics.pickupsAwaitingCollection],
      completedPickups: ['Completed pickups', metrics.completedPickups],
      closedOffers: ['Closed offers', metrics.closedOffers],
      totalOffers: ['Total food offers', metrics.totalOffers]
    };
    const answer = [
      ...(plan.unsupportedTimeRange ? ['I can provide current totals, but date-specific counts and trends are not available yet.'] : []),
      ...selected.map(key => `${labels[key][0]}: ${labels[key][1]}.`),
      ...(!selected.length ? ['I can answer current totals for customers, restaurants, restaurant applications, available offers, pickups awaiting collection, completed pickups, and closed offers.'] : [])
    ].join(' ');
    return res.json({ answer, metrics });
  } catch (error) {
    return handleGeminiError(error, res, 'Gemini admin insights');
  }
});

export default router;
