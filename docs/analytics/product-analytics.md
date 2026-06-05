# SOLOMON Product Analytics

## North Star

**Weekly Active Conversationalists (WAC)**

Definition: brokers with at least 3 `conversation_completed` events in the last
7 days.

Why it matters: SOLOMON creates commercial value when brokers repeatedly use the
AI workflow to answer insurance questions, compare insurers, and prepare
client-facing work.

## Event Taxonomy

Events follow `object_verb_past`, matching the product analytics skill:

| Funnel Area | Event |
| --- | --- |
| Activation | `broker_profile_bootstrapped` |
| Activation | `broker_profile_updated` |
| Activation | `client_created` |
| Activation | `conversation_started` |
| Activation | `conversation_completed` |
| Core workflow | `comparison_started` |
| Core workflow | `comparison_completed` |
| Core workflow | `pre_sinistro_analysis_started` |
| Core workflow | `pre_sinistro_analysis_completed` |
| Retention | `session_started` |
| Quality | `feedback_submitted` |
| Monetization | `quota_exceeded` |
| Monetization | `upgrade_viewed` |
| Monetization | `upgrade_started` |
| Monetization | `upgrade_completed` |
| Monetization | `payment_failed` |
| Monetization | `subscription_canceled` |

## PII Contract

`product_analytics_events.properties` must not store raw questions, claim
descriptions, CPF, phone, email, names, comments, notes, or prompts.

Allowed examples:

- ids: `conversation_id`, `client_id`, `analysis_id`
- dimensions: `channel`, `plan`, `insurer_name`, `claim_type`, `product_type`
- counts: `citations_count`, `tokens_used`, `history_messages_count`
- booleans: `low_confidence`, `has_broker_client`, `has_product_hint`
- buckets: `question_length_bucket`, `description_length_bucket`

## Admin Endpoint

`GET /api/admin/product-analytics?days=30`

Access is restricted to emails listed in `PRODUCT_ANALYTICS_ADMIN_EMAILS`
comma-separated env var. If the env var is absent or the caller is not listed,
the endpoint returns `403`.

Response includes:

- `northStar`
- `activationFunnel`
- `eventCounts`
- `eventsByDay`
- `retention`

## Dashboard Targets

Initial dashboard sections:

1. WAC and week-over-week growth.
2. Activation funnel: profile -> client -> conversation started -> conversation
   completed -> feedback.
3. Core workflow mix: ask, compare, pre-sinistro.
4. Quality: low-confidence rate and feedback rating distribution.
5. Monetization: quota exceeded and upgrade events.
