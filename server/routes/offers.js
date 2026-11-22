import { Router } from 'express';
import mongoose from 'mongoose';
import { Offer } from '../models/Offer.js';
import { User } from '../models/User.js';
import { allowRoles, requireAuth } from '../middleware/auth.js';

const router = Router();
const categories = ['produce', 'prepared-meals', 'bakery', 'other'];
const clean = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const validId = id => mongoose.isValidObjectId(id);

function serialize(offer) {
  return {
    id: String(offer._id), title: offer.title, description: offer.description, category: offer.category,
    quantity: offer.quantity, neighborhood: offer.neighborhood,
    pickupStartsAt: offer.pickupStartsAt, pickupEndsAt: offer.pickupEndsAt,
    handlingNotes: offer.handlingNotes, status: offer.status,
    restaurant: offer.restaurant && typeof offer.restaurant === 'object'
      ? { id: String(offer.restaurant._id), name: offer.restaurant.name, organizationName: offer.restaurant.organizationName, neighborhood: offer.restaurant.neighborhood }
      : String(offer.restaurant), claimedBy: offer.claimedBy ? String(offer.claimedBy) : null,
    createdAt: offer.createdAt
  };
}

router.get('/', async (req, res) => {
  const query = { status: 'available' };
  if (typeof req.query.category === 'string' && categories.includes(req.query.category)) query.category = req.query.category;
  if (typeof req.query.q === 'string' && req.query.q.trim()) {
    const escaped = req.query.q.trim().slice(0, 80).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    query.$or = [{ title: new RegExp(escaped, 'i') }, { neighborhood: new RegExp(escaped, 'i') }, { description: new RegExp(escaped, 'i') }];
  }
  const offers = await Offer.find(query).sort({ pickupStartsAt: 1 }).limit(100)
    .populate({ path: 'restaurant', match: { role: 'restaurant', status: 'active' }, select: 'name organizationName neighborhood' });
  res.json({ offers: offers.filter(offer => offer.restaurant).map(serialize) });
});

router.use(requireAuth);

router.get('/mine', allowRoles('restaurant'), async (req, res) => {
  const offers = await Offer.find({ restaurant: req.user._id }).sort({ createdAt: -1 }).limit(200).populate('restaurant', 'name organizationName neighborhood');
  res.json({ offers: offers.map(serialize) });
});

router.get('/saved/mine', allowRoles('consumer'), async (req, res) => {
  const user = await req.user.populate('savedOffers');
  const offers = await Offer.populate(user.savedOffers.filter(offer => offer && offer.status !== 'closed'), { path: 'restaurant', match: { role: 'restaurant', status: 'active' }, select: 'name organizationName neighborhood' });
  res.json({ offers: offers.filter(offer => offer.restaurant).map(serialize) });
});

router.put('/:id/saved', allowRoles('consumer'), async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Invalid offer id.' });
  const { saved } = req.body || {};
  if (typeof saved !== 'boolean') return res.status(400).json({ error: 'Set saved to true or false.' });
  const exists = await Offer.exists({ _id: req.params.id, restaurant: { $exists: true } });
  if (!exists) return res.status(404).json({ error: 'Offer not found.' });
  await User.findByIdAndUpdate(req.user._id, saved
    ? { $addToSet: { savedOffers: req.params.id } }
    : { $pull: { savedOffers: req.params.id } });
  res.json({ saved });
});

router.post('/', allowRoles('restaurant'), async (req, res) => {
  const { title, description = '', category, quantity, neighborhood, pickupStartsAt, pickupEndsAt, handlingNotes = '' } = req.body || {};
  const starts = new Date(pickupStartsAt);
  const ends = new Date(pickupEndsAt);
  if (clean(title, 120).length < 3) return res.status(400).json({ error: 'Offer name must be at least 3 characters.' });
  if (!categories.includes(category)) return res.status(400).json({ error: 'Choose a valid food category.' });
  if (!clean(quantity, 120)) return res.status(400).json({ error: 'Add the available quantity.' });
  if (!clean(neighborhood, 120)) return res.status(400).json({ error: 'Add a collection neighbourhood.' });
  if (!Number.isFinite(starts.getTime()) || !Number.isFinite(ends.getTime()) || ends <= starts) return res.status(400).json({ error: 'Add a valid pickup window.' });
  if (ends.getTime() < Date.now()) return res.status(400).json({ error: 'Pickup window must end in the future.' });
  const offer = await Offer.create({
    title: clean(title, 120), description: clean(description, 1000), category, quantity: clean(quantity, 120),
    neighborhood: clean(neighborhood, 120), pickupStartsAt: starts, pickupEndsAt: ends,
    handlingNotes: clean(handlingNotes, 1000), restaurant: req.user._id
  });
  await offer.populate('restaurant', 'name organizationName neighborhood');
  res.status(201).json({ offer: serialize(offer) });
});

router.get('/claims/mine', allowRoles('consumer'), async (req, res) => {
  const offers = await Offer.find({ claimedBy: req.user._id }).sort({ claimedAt: -1 }).populate('restaurant', 'name organizationName neighborhood');
  res.json({ claims: offers.map(serialize) });
});

router.post('/:id/claim', allowRoles('consumer'), async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Invalid offer id.' });
  const offer = await Offer.findOneAndUpdate(
    { _id: req.params.id, status: 'available' },
    { $set: { status: 'claimed', claimedBy: req.user._id, claimedAt: new Date() } },
    { new: true, runValidators: true }
  ).populate('restaurant', 'name organizationName neighborhood');
  if (!offer) return res.status(409).json({ error: 'This offer is no longer available.' });
  res.status(201).json({ claim: serialize(offer) });
});

router.patch('/:id/status', async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Invalid offer id.' });
  if (!['restaurant', 'administrator'].includes(req.user.role)) return res.status(403).json({ error: 'Only a restaurant or administrator can change offer status.' });
  const { status } = req.body || {};
  const allowed = req.user.role === 'administrator' ? ['available', 'closed'] : ['closed', 'collected'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'That status change is not allowed.' });
  const query = { _id: req.params.id };
  if (req.user.role === 'restaurant') {
    query.restaurant = req.user._id;
    if (status === 'closed') query.status = 'available';
    if (status === 'collected') query.status = 'claimed';
  }
  const offer = await Offer.findOneAndUpdate(query, { $set: { status } }, { new: true, runValidators: true }).populate('restaurant', 'name organizationName neighborhood');
  if (!offer) return res.status(404).json({ error: 'Offer not found or cannot be changed.' });
  res.json({ offer: serialize(offer) });
});

export default router;
