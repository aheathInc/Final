#!/usr/bin/env bash
#
# Corrected version of expand-contract-payment.sh.
#
# The first version failed at its very first step — matching the line
# `  - name: insurance` to insert the payment tag next to it — and because the
# whole script builds its output in memory and writes the file only once at
# the very end, that single failure meant NOTHING was written: the contract
# still has zero payment endpoints despite the database already having the
# payment tables (that migration succeeded independently and is fine).
#
# This version stops anchoring on lines next to other content and anchors
# instead on singular, structurally-guaranteed top-level YAML keys:
# `components:` for where the paths block goes, `parameters:` for the two new
# path parameters, `securitySchemes:` for the webhook auth scheme. These
# cannot be affected by whitespace drift the way a comment or a sibling
# field's exact text can.
#
# Safe to run even though the first attempt made no changes at all.
#
# Run from the repo root:
#   bash expand-contract-payment-v2.sh
#
set -euo pipefail

ROOT="$(pwd)"
API="$ROOT/packages/api/openapi/a-health-api-v1.yaml"

[ -f "$ROOT/pnpm-workspace.yaml" ] || { echo "Run this from the repo root."; exit 1; }
[ -f "$API" ] || { echo "Contract not found."; exit 1; }

cp "$API" "$API.bak2"

python3 - "$API" << 'PYEOF'
import re, sys
path = sys.argv[1]
doc = open(path, newline=None).read()  # newline=None normalises \r\n to \n on read

if '/payments/intents:' in doc:
    print('  contract already has payment domain')
    sys.exit(0)

# ---------------------------------------------------------------------------
# 1. Tag — regex on the line itself, tolerant of whatever indent is actually
#    there, rather than a literal multi-character block.
# ---------------------------------------------------------------------------
tag_match = re.search(r'\n( *)- name: insurance\n', doc)
if not tag_match:
    print('  insurance tag line not found by regex either; aborting')
    sys.exit(1)
indent = tag_match.group(1)
tag_block = (
    f"\n{indent}- name: payment\n"
    f"{indent}  description: Payment intents for consultations and pharmacy purchases — mobile money, card, cash. Phase 4.\n"
)
insert_at = tag_match.start()
doc = doc[:insert_at] + tag_block + doc[insert_at + 1:]
print('  tag: payment added next to insurance')

# ---------------------------------------------------------------------------
# 2. Paths — anchor on the singular top-level `components:` key rather than a
#    comment block, so the insertion point cannot be lost to a heading edit.
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

components_match = re.search(r'\ncomponents:\n', doc)
if not components_match:
    print('  top-level `components:` key not found; cannot place payment paths')
    sys.exit(1)
insert_at = components_match.start()
doc = doc[:insert_at] + '\n' + PATHS.strip('\n') + '\n' + doc[insert_at + 1:]
print('  paths: payment endpoints inserted before components:')

# ---------------------------------------------------------------------------
# 3. Parameters — anchor on the singular `  parameters:` section header,
#    insert the two new path parameters right after it. Position within the
#    map does not matter in YAML.
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
params_match = re.search(r'\n  parameters:\n', doc)
if not params_match:
    print('  `  parameters:` section header not found; params not added')
else:
    insert_at = params_match.end()
    doc = doc[:insert_at] + PARAMS + doc[insert_at:]
    print('  parameters: PaymentIntentId, PaymentId added')

# ---------------------------------------------------------------------------
# 4. securitySchemes — same pattern: singular section header, insert after it.
#
# Checked against just the securitySchemes block, not the whole document: by
# this point the payment paths already contain a `- webhookSignature: []`
# usage reference (in the webhook operation's own `security:` list), and a
# whole-document substring check would see that usage and wrongly conclude
# the scheme was already defined, leaving the reference pointing at nothing.
# ---------------------------------------------------------------------------
sec_block_match = re.search(r'\n  securitySchemes:\n([\s\S]*?)(?=\n  \w+:\n|\Z)', doc)
if sec_block_match and 'webhookSignature:' in sec_block_match.group(1):
    print('  securitySchemes already has webhookSignature')
else:
    sec_match = re.search(r'\n  securitySchemes:\n', doc)
    if not sec_match:
        print('  `  securitySchemes:` section header not found; scheme not added')
    else:
        SECURITY = (
            "    webhookSignature:\n"
            "      type: apiKey\n"
            "      in: header\n"
            "      name: X-Webhook-Signature\n"
            "      description: |\n"
            "        HMAC of the raw request body using the shared per-provider secret.\n"
            "        Used only on /payments/webhooks/*, paired with a source-IP allow-list\n"
            "        where the provider publishes one.\n"
        )
        insert_at = sec_match.end()
        doc = doc[:insert_at] + SECURITY + doc[insert_at:]
        print('  securitySchemes: webhookSignature added')

# ---------------------------------------------------------------------------
# 5. Error codes and sync entities — these two anchors are deep, singular
#    lines inside enums that no other script has touched since the original
#    restore; kept as literal matches.
# ---------------------------------------------------------------------------
if '        - PAYMENT_METHOD_UNAVAILABLE' not in doc:
    ERRORS = (
        "        - PAYMENT_METHOD_UNAVAILABLE\n"
        "        - PAYMENT_ALREADY_SETTLED\n"
        "        - REFUND_EXCEEDS_PAYMENT\n"
        "        - PAYER_PHONE_REQUIRED\n"
        "        - DUPLICATE_RESOURCE"
    )
    if '        - DUPLICATE_RESOURCE' in doc:
        doc = doc.replace('        - DUPLICATE_RESOURCE', ERRORS, 1)
        print('  error codes: payment codes added')
    else:
        print('  DUPLICATE_RESOURCE anchor not found; error codes not added')

if '        - payment_intents' not in doc:
    if '        - patient_profiles' in doc:
        doc = doc.replace(
            '        - patient_profiles',
            '        - payment_intents\n        - patient_profiles',
            1,
        )
        print('  sync entities: payment_intents added')
    else:
        print('  patient_profiles sync anchor not found; sync entity not added')

# ---------------------------------------------------------------------------
# 6. Schemas — appended at the end of the file, as every prior expansion did.
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
print('  schemas: PaymentMethod/Provider/Purpose/Status/Intent/Payment/Refund added')
print('  contract written to disk')
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

if '/payments/intents' not in d['paths']:
    print('  VERIFY FAILED: /payments/intents not in final paths')
    sys.exit(1)
if 'PaymentIntent' not in d['components']['schemas']:
    print('  VERIFY FAILED: PaymentIntent schema not present')
    sys.exit(1)
if 'webhookSignature' not in d['components'].get('securitySchemes', {}):
    print('  VERIFY FAILED: webhookSignature is referenced but not defined in securitySchemes')
    sys.exit(1)

if bad or dupes:
    sys.exit(1)
print('  verified on disk: payment domain present')
PY

echo
echo "Next:"
echo "  pnpm --filter @a-health/api lint"
echo "  pnpm --filter @a-health/api generate"
