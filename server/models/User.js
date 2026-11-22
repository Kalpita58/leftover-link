import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ['consumer', 'restaurant', 'administrator'], required: true },
  status: { type: String, enum: ['active', 'pending', 'needs-information', 'rejected', 'suspended'], default: 'active', required: true },
  organizationName: { type: String, trim: true, maxlength: 120, default: '' },
  neighborhood: { type: String, trim: true, maxlength: 120, default: '' },
  savedOffers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Offer' }]
}, { timestamps: true, versionKey: false });

userSchema.index({ role: 1, status: 1 });

export const User = mongoose.model('User', userSchema);
