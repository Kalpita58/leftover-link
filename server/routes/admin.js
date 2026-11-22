import { Router } from 'express';
import mongoose from 'mongoose';
import { User } from '../models/User.js';
import { Offer } from '../models/Offer.js';
import { allowRoles, publicUser, requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth, allowRoles('administrator'));

router.get('/partners', async (req, res) => {
  const allowed = ['pending', 'needs-information', 'active', 'rejected', 'suspended'];
  const status = typeof req.query.status === 'string' && allowed.includes(req.query.status) ? req.query.status : undefined;
  const query = { role: 'restaurant', ...(status ? { status } : {}) };
  const partners = await User.find(query).sort({ createdAt: -1 }).limit(200);
  res.json({ partners: partners.map(user => publicUser(user)) });
});

router.patch('/partners/:id/status', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid partner id.' });
  const { status } = req.body || {};
  if (!['active', 'needs-information', 'rejected', 'suspended'].includes(status)) return res.status(400).json({ error: 'Choose an allowed partner status.' });
  const partner = await User.findOneAndUpdate(
    { _id: req.params.id, role: 'restaurant' }, { $set: { status } }, { new: true, runValidators: true }
  );
  if (!partner) return res.status(404).json({ error: 'Restaurant account not found.' });
  res.json({ partner: publicUser(partner) });
});

router.get('/offers', async (req, res) => {
  const offers = await Offer.find().sort({ createdAt: -1 }).limit(200).populate('restaurant', 'name organizationName neighborhood');
  res.json({ offers: offers.map(offer => ({
    id: String(offer._id), title: offer.title, category: offer.category, quantity: offer.quantity,
    status: offer.status, neighborhood: offer.neighborhood, pickupStartsAt: offer.pickupStartsAt,
    restaurant: offer.restaurant ? offer.restaurant.organizationName || offer.restaurant.name : 'Restaurant account'
  })) });
});

export default router;
