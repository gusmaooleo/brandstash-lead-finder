import mongoose from 'mongoose'
import { config } from './config'

export async function connectDb(): Promise<void> {
  mongoose.set('strictQuery', true)
  await mongoose.connect(config.mongodbUri)
  // Never echo the URI itself — it may carry credentials.
  const { host, port, name } = mongoose.connection
  console.log(`[db] connected (${host}:${port}/${name})`)
}
