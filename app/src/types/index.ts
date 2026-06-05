import type { Tables } from './database'
export type { Database, Tables, TablesInsert, TablesUpdate, Json } from './database'

// Convenience type aliases
export type Insurer = Tables<'insurers'>
export type Product = Tables<'products'>
export type Coverage = Tables<'coverages'>
export type Document = Tables<'documents'>
export type Broker = Tables<'brokers'>
export type BrokerClient = Tables<'broker_clients'>
export type Policy = Tables<'policies'>
export type Conversation = Tables<'conversations'>
export type ClaimAnalysis = Tables<'claim_analyses'>
export type Simulation = Tables<'simulations'>
export type Proposal = Tables<'proposals'>
export type PricingTable = Tables<'pricing_tables'>
export type Alert = Tables<'alerts'>
export type IngestionLog = Tables<'ingestion_logs'>
export type AuditLog = Tables<'audit_log'>
export type SubscriptionEvent = Tables<'subscription_events'>
export type ProductAnalyticsEvent = Tables<'product_analytics_events'>
export type IdempotencyKey = Tables<'idempotency_keys'>
