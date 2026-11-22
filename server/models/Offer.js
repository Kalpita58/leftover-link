import mongoose from 'mongoose';

const offerSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 120 },
  description: { type: String, trim: true, maxlength: 1000, default: '' },
  category: { type: String, enum: ['produce', 'prepared-meals', 'bakery', 'other'], required: true },
  quantity: { type: String, required: true, trim: true, maxlength: 120 },
  neighborhood: { type: String, required: true, trim: true, maxlength: 120 },
  pickupStartsAt: { type: Date, required: true },
  pickupEndsAt: { type: Date, required: true },
  handlingNotes: { type: String, trim: true, maxlength: 1000, default: '' },
  restaurant: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  status: { type: String, enum: ['available', 'claimed', 'collected', 'closed'], default: 'available', index: true },
  claimedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  claimedAt: { type: Date, default: null }
}, { timestamps: true, versionKey: false });

offerSchema.index({ status: 1, pickupStartsAt: 1 });
offerSchema.index({ neighborhood: 1, category: 1 });

export const Offer = mongoose.model('Offer', offerSchema);
