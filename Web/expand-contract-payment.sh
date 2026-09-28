#!/usr/bin/env bash
#
# Adds the payment domain to the contract. Missed entirely during
# restore-full-contract.sh — insurance (coverage/claims) was restored, but
# direct payment for a consultation or a pharmacy purchase (mobile money,
# card, cash) was not.
#
# Tanzania's mobile money landscape (M-Pesa, Tigo Pesa, Airtel Money) is
# provider-fragmented and callback-driven: you create an intent, the provider
# calls back asynchronously, and the payment settles or fails on its own
# schedule, sometimes minutes later. The contract is built around that shape
# — a PaymentIntent with a provider-agnostic status, and a webhook endpoint
# the providers actually call.
#
# Run from the repo root:
#   bash expand-contract-payment.sh
#
set -euo pipefail

ROOT="$(pwd)"
API="$ROOT/packages/api/openapi/a-health-api-v1.yaml"

[ -f "$ROOT/pnpm-workspace.yaml" ] || { echo "Run this from the repo root."; exit 1; }
[ -f "$API" ] || { echo "Contract not found."; exit 1; }

cp "$API" "$API.bak"

python3 - "$API" << 'PYEOF'
import sys
path = sys.argv[1]
doc = open(path).read()

if '/payments/intents:' in doc:
    print('  contract already has payment domain')
    sys.exit(0)

# ---------------------------------------------------------------------------
TAG = "  - name: payment\n    description: Payment intents for consultations and pharmacy purchases — mobile money, card, cash. Phase 4.\n"
anchor = "  - name: insurance\n"
if anchor not in doc:
    print('  insurance tag anchor not found'); sys.exit(1)
doc = doc.replace(anchor, TAG + anchor, 1)

# ---------------------------------------------------------------------------
PATHS = r"""
  # ----------------------------------------------------------------------
  # Payment
  # ----------------------------------------------------------------------

  /payments/intents:
    post:
      tags: [payment]
      summary: Create a payment intent
      description: |
        One intent per payable thing — a consultation fee, a pharmacy
        purchase, an insurance co-payment. For mobile money the response
        carries whatever the provider needs the client to show the payer (a
        USSD push confirmation, a reference code); the intent then settles
        asynchronously as the provider calls the webhook below.

        Cash and card-on-file settle synchronously and return `succeeded`
        immediately; mobile money almost never does.
      operationId: createPaymentIntent
      parameters:
        - $ref: '#/components/parameters/IdempotencyKey'
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [amount, currency, method, purpose]
              properties:
                amount: { type: number, minimum: 1 }
                currency:
                  type: string
                  default: TZS
                method: { $ref: '#/components/schemas/PaymentMethod' }
                purpose: { $ref: '#/components/schemas/PaymentPurpose' }
                consultation_id: { type: string, format: uuid }
                dispensing_id: { type: string, format: uuid }
                insurance_claim_id: { type: string, format: uuid }
                payer_phone:
                  $ref: '#/components/schemas/PhoneNumber'
                  description: Required for mobile money; the number the provider prompt is sent to.
                return_url: { type: string, format: uri }
      responses:
        '201':
          description: Intent created
          content:
            application/json:
              schema: { $ref: '#/components/schemas/PaymentIntent' }
        '422': { $ref: '#/components/responses/UnprocessableEntity' }

  /payments/intents/{payment_intent_id}:
    get:
      tags: [payment]
      summary: Get a payment intent
      description: |
        Poll this while a mobile money intent is `processing`. The webhook is
        what actually resolves it; this is what the client checks in the
        meantime, since a USSD push confirmation is not itself proof of
        settlement.
      operationId: getPaymentIntent
      parameters:
        - $ref: '#/components/parameters/PaymentIntentId'
      responses:
        '200':
          description: Payment intent
          content:
            application/json:
              schema: { $ref: '#/components/schemas/PaymentIntent' }
        '404': { $ref: '#/components/responses/NotFound' }

  /payments/intents/{payment_intent_id}/cancel:
    post:
      tags: [payment]
      summary: Cancel a payment intent before it settles
      description: |
        Only legal while `pending` or `requires_action`. Once a provider has
        reported success there is nothing left to cancel — that is a refund.
      operationId: cancelPaymentIntent
      parameters:
        - $ref: '#/components/parameters/PaymentIntentId'
        - $ref: '#/components/parameters/IdempotencyKey'
      responses:
        '200':
          description: Cancelled
          content:
            application/json:
              schema: { $ref: '#/components/schemas/PaymentIntent' }
        '409': { $ref: '#/components/responses/Conflict' }

  /payments/{payment_id}/refund:
    post:
      tags: [payment]
      summary: Refund a settled payment, in full or in part
      description: |
        Admin or facility-finance action. A partial refund may be issued more
        than once against the same payment as long as the running total does
        not exceed what was originally paid.
      operationId: refundPayment
      parameters:
        - $ref: '#/components/parameters/PaymentId'
        - $ref: '#/components/parameters/IdempotencyKey'
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [reason]
              properties:
                amount:
                  type: number
                  description: Omit to refund the full remaining amount.
                reason: { type: string, maxLength: 500 }
      responses:
        '201':
          description: Refund recorded
          content:
            application/json:
              schema: { $ref: '#/components/schemas/PaymentRefund' }
        '409': { $ref: '#/components/responses/Conflict' }
        '422': { $ref: '#/components/responses/UnprocessableEntity' }

  /payments:
    get:
      tags: [payment]
      summary: List payments
      operationId: listPayments
      parameters:
        - name: consultation_id
          in: query
          schema: { type: string, format: uuid }
        - name: status
          in: query
          schema: { $ref: '#/components/schemas/PaymentStatus' }
        - $ref: '#/components/parameters/Cursor'
        - $ref: '#/components/parameters/Limit'
      responses:
        '200':
          description: Payments
          content:
            application/json:
              schema:
                type: object
                required: [data, meta]
                properties:
                  data:
                    type: array
                    items: { $ref: '#/components/schemas/Payment' }
                  meta: { $ref: '#/components/schemas/CursorMeta' }

  /payments/webhooks/{provider}:
    post:
      tags: [payment]
      summary: Provider settlement callback
      description: |
        Called by the mobile money provider, not by any client of this API.
        Authenticated by a provider-specific signature header rather than a
        bearer token — the provider does not have one. Idempotent by the
        provider's own transaction reference: replays of the same callback
        (providers retry aggressively) must resolve to the same outcome
        without double-crediting anything.
      operationId: handlePaymentWebhook
      security:
        - webhookSignature: []
      parameters:
        - name: provider
          in: path
          required: true
          schema: { $ref: '#/components/schemas/PaymentProvider' }
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              additionalProperties: true
              description: Provider-specific payload; shape varies by provider.
      responses:
        '200':
          description: Acknowledged
        '401': { $ref: '#/components/responses/Unauthenticated' }

"""

marker = "  # ----------------------------------------------------------------------\n  # Quality — ratings and incidents"
if marker not in doc:
    print('  quality marker not found; aborting'); sys.exit(1)
doc = doc.replace(marker, PATHS.lstrip('\n') + marker, 1)

# ---------------------------------------------------------------------------
PARAMS = """    PaymentIntentId:
      name: payment_intent_id
      in: path
      required: true
      schema: { type: string, format: uuid }
    PaymentId:
      name: payment_id
      in: path
      required: true
      schema: { type: string, format: uuid }
"""
anchor2 = "    QueryId:\n      name: query_id\n      in: path\n      required: true\n      schema: { type: string, format: uuid }\n"
if anchor2 not in doc:
    print('  QueryId parameter anchor not found; params not added')
else:
    doc = doc.replace(anchor2, anchor2 + PARAMS, 1)

# ---------------------------------------------------------------------------
SECURITY = """    webhookSignature:
      type: apiKey
      in: header
      name: X-Webhook-Signature
      description: |
        HMAC of the raw request body using the shared per-provider secret.
        Used only on /payments/webhooks/*, paired with a source-IP allow-list
        where the provider publishes one.
"""
anchor3 = "  securitySchemes:\n"
if anchor3 not in doc:
    print('  securitySchemes anchor not found; webhook scheme not added')
else:
    idx = doc.index(anchor3) + len(anchor3)
    doc = doc[:idx] + SECURITY + doc[idx:]

# ---------------------------------------------------------------------------
ERRORS = """        - PAYMENT_METHOD_UNAVAILABLE
        - PAYMENT_ALREADY_SETTLED
        - REFUND_EXCEEDS_PAYMENT
        - PAYER_PHONE_REQUIRED
        - DUPLICATE_RESOURCE"""
if '        - PAYMENT_METHOD_UNAVAILABLE' not in doc:
    doc = doc.replace("        - DUPLICATE_RESOURCE", ERRORS, 1)

SYNC = """        - payment_intents
        - patient_profiles"""
if '        - payment_intents' not in doc:
    doc = doc.replace("        - patient_profiles", SYNC, 1)

# ---------------------------------------------------------------------------
SCHEMAS = r"""
    PaymentMethod:
      type: string
      enum: [mobile_money, card, cash, insurance]

    PaymentProvider:
      type: string
      enum: [mpesa, tigo_pesa, airtel_money, card_gateway, manual]

    PaymentPurpose:
      type: string
      enum: [consultation_fee, pharmacy_purchase, insurance_copay, subscription, other]

    PaymentStatus:
      type: string
      enum: [pending, requires_action, processing, succeeded, failed, cancelled, refunded, partially_refunded]

    PaymentIntent:
      type: object
      required: [id, amount, currency, method, purpose, status, created_at, version]
      properties:
        id: { type: string, format: uuid }
        amount: { type: number }
        currency: { type: string }
        method: { $ref: '#/components/schemas/PaymentMethod' }
        provider:
          type: [string, 'null']
          description: Resolved once a mobile money provider is selected; null for cash.
        purpose: { $ref: '#/components/schemas/PaymentPurpose' }
        consultation_id: { type: [string, 'null'], format: uuid }
        dispensing_id: { type: [string, 'null'], format: uuid }
        insurance_claim_id: { type: [string, 'null'], format: uuid }
        status: { $ref: '#/components/schemas/PaymentStatus' }
        provider_reference:
          type: [string, 'null']
          description: |
            The provider's own transaction id. This is what a support
            conversation with the mobile money operator is conducted against
            — not this platform's internal id.
        client_action:
          type: [object, 'null']
          description: What the payer must do next — e.g. dial a USSD confirmation, or nothing for card/cash.
          additionalProperties: true
        payment_id:
          type: [string, 'null']
          format: uuid
          description: Set once the intent settles into a completed Payment record.
        created_at: { type: string, format: date-time }
        expires_at: { type: [string, 'null'], format: date-time }
        version: { type: integer }

    Payment:
      type: object
      required: [id, payment_intent_id, amount, currency, method, status, settled_at, version]
      properties:
        id: { type: string, format: uuid }
        payment_intent_id: { type: string, format: uuid }
        amount: { type: number }
        currency: { type: string }
        method: { $ref: '#/components/schemas/PaymentMethod' }
        provider: { type: [string, 'null'] }
        provider_reference: { type: [string, 'null'] }
        purpose: { $ref: '#/components/schemas/PaymentPurpose' }
        consultation_id: { type: [string, 'null'], format: uuid }
        payer_user_id: { type: [string, 'null'], format: uuid }
        status: { $ref: '#/components/schemas/PaymentStatus' }
        refunded_amount: { type: number }
        settled_at: { type: string, format: date-time }
        version: { type: integer }

    PaymentRefund:
      type: object
      required: [id, payment_id, amount, reason, created_at]
      properties:
        id: { type: string, format: uuid }
        payment_id: { type: string, format: uuid }
        amount: { type: number }
        reason: { type: string }
        issued_by_id: { type: [string, 'null'], format: uuid }
        provider_reference: { type: [string, 'null'] }
        created_at: { type: string, format: date-time }
"""

doc = doc.rstrip('\n') + '\n' + SCHEMAS.lstrip('\n')
open(path, 'w').write(doc)
print('  contract: payment domain added')
PYEOF

python3 - "$API" << 'PY'
import sys, re, yaml
p = sys.argv[1]
d = yaml.safe_load(open(p))
txt = open(p).read()

print(f"  paths: {len(d['paths'])} | schemas: {len(d['components']['schemas'])} | tags: {len(d['tags'])}")

refs = set(re.findall(r"\$ref: '(#/[^']+)'", txt))
bad = []
for r in refs:
    n = d
    for part in r.lstrip('#/').split('/'):
        if isinstance(n, dict) and part in n:
            n = n[part]
        else:
            bad.append(r); break
print(f"  refs: {len(refs)} | broken: {bad or 'none'}")

ops = [o['operationId'] for pi in d['paths'].values() for k, o in pi.items() if isinstance(o, dict) and 'operationId' in o]
dupes = {o for o in ops if ops.count(o) > 1}
print(f"  operations: {len(ops)} | duplicate ids: {dupes or 'none'}")
if bad or dupes:
    sys.exit(1)
PY

echo
echo "Next:"
echo "  pnpm --filter @a-health/api lint"
echo "  pnpm --filter @a-health/api generate"
