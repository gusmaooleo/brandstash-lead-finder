import mongoose, { Schema, type InferSchemaType } from 'mongoose'

const inboundReplySchema = new Schema(
  {
    provider: { type: String, required: true, default: 'resend' },
    provider_email_id: { type: String, required: true, unique: true },
    message_id: { type: String, default: null },
    email_send_id: { type: Schema.Types.ObjectId, ref: 'EmailSend', default: null, index: true },
    place_id: { type: String, default: null, index: true },
    from_email: { type: String, required: true },
    from_name: { type: String, default: null },
    to_email: { type: String, required: true },
    subject: { type: String, default: '' },
    preview: { type: String, default: '' },
    kind: { type: String, required: true, enum: ['human', 'automatic', 'bounce'], index: true },
    classification_reason: { type: String, default: null },
    correlation: { type: String, required: true, enum: ['exact', 'unattributed'], index: true },
    received_at: { type: Date, required: true, index: true },
    read_at: { type: Date, default: null, index: true },
  },
  { collection: 'inbound_replies', timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } },
)
inboundReplySchema.index({ kind: 1, read_at: 1, received_at: -1 })

export type InboundReplyDoc = mongoose.HydratedDocument<InferSchemaType<typeof inboundReplySchema>>
export const InboundReply = mongoose.model('InboundReply', inboundReplySchema)
