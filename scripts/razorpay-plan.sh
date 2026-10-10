#!/usr/bin/env bash
# Creates the ₹199-every-30-days plan once per Razorpay mode (test and live each need
# their own). Prints the plan id to put in server/.env as RAZORPAY_PLAN_ID.
#
#   RAZORPAY_KEY_ID=rzp_test_... RAZORPAY_KEY_SECRET=... scripts/razorpay-plan.sh
set -euo pipefail
#
# Daily × 30 rather than monthly: a "monthly" plan bills on the calendar date
# (28–31 days apart), and the paywall promises exactly 30.

: "${RAZORPAY_KEY_ID:?set RAZORPAY_KEY_ID}"
: "${RAZORPAY_KEY_SECRET:?set RAZORPAY_KEY_SECRET}"

curl -sS -u "$RAZORPAY_KEY_ID:$RAZORPAY_KEY_SECRET" \
  -H 'Content-Type: application/json' \
  -X POST https://api.razorpay.com/v1/plans \
  -d '{
    "period": "daily",
    "interval": 30,
    "item": { "name": "VocaLock Premium (30 days)", "amount": 19900, "currency": "INR" }
  }'
echo
