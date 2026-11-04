"""THROWAWAY SPIKE: checks the PayPal sandbox can carry the Dispute Defense demo.

Stdlib only. Reads PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET from spike/.env.

    python spike.py token                     # OAuth works, print granted scopes
    python spike.py order                     # create a $20 order, print the buyer approve link
    python spike.py capture ORDER_ID          # capture after the sandbox buyer approved
    python spike.py track ORDER_ID CAPTURE_ID # add a tracker (spike 3)
    python spike.py disputes                  # list disputes (spike 1 pass check)
    python spike.py dispute DISPUTE_ID        # dispute details + allowed actions
    python spike.py evidence DISPUTE_ID       # file PROOF_OF_FULFILLMENT (spike 2)
"""

import base64
import json
import sys
import urllib.error
import urllib.request
import uuid
from pathlib import Path

API = "https://api-m.sandbox.paypal.com"


def load_env():
    env = {}
    for line in (Path(__file__).parent / ".env").read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            env[key.strip()] = value.strip()
    return env


def call(method, path, token=None, body=None, headers=None, raw=None):
    hdrs = dict(headers or {})
    if token:
        hdrs["Authorization"] = f"Bearer {token}"
    data = raw
    if body is not None:
        data = json.dumps(body).encode()
        hdrs["Content-Type"] = "application/json"
    req = urllib.request.Request(API + path, data=data, method=method, headers=hdrs)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            text = resp.read().decode()
            print(f"{method} {path} -> {resp.status}")
            return json.loads(text) if text else {}
    except urllib.error.HTTPError as err:
        print(f"{method} {path} -> {err.code}")
        print(err.read().decode())
        sys.exit(1)


def token():
    env = load_env()
    basic = base64.b64encode(
        f"{env['PAYPAL_CLIENT_ID']}:{env['PAYPAL_CLIENT_SECRET']}".encode()
    ).decode()
    return call(
        "POST",
        "/v1/oauth2/token",
        headers={
            "Authorization": f"Basic {basic}",
            "Content-Type": "application/x-www-form-urlencoded",
        },
        raw=b"grant_type=client_credentials",
    )


def access_token():
    return token()["access_token"]


def show(obj):
    print(json.dumps(obj, indent=2))


def main(argv):
    cmd, args = argv[0], argv[1:]
    if cmd not in ("token", "order", "capture", "track", "disputes", "dispute", "evidence"):
        print(__doc__)
        return
    if cmd == "token":
        scopes = token()["scope"].split()
        print(
            "\n".join(s for s in scopes if "dispute" in s or "checkout" in s or "payments" in s)
            or "(no matching scopes)"
        )
        print(f"{len(scopes)} scopes total")
        return
    tok = access_token()
    if cmd == "order":
        order = call(
            "POST",
            "/v2/checkout/orders",
            tok,
            {
                "intent": "CAPTURE",
                "purchase_units": [
                    {
                        "amount": {"currency_code": "USD", "value": "20.00"},
                        "description": "Spike test item",
                    }
                ],
                "payment_source": {
                    "paypal": {
                        "experience_context": {
                            "return_url": "https://example.com/return",
                            "cancel_url": "https://example.com/cancel",
                        }
                    }
                },
            },
            headers={"PayPal-Request-Id": str(uuid.uuid4())},
        )
        print("ORDER_ID", order["id"])
        for link in order["links"]:
            if link["rel"] in ("approve", "payer-action"):
                print("Approve as the sandbox buyer:", link["href"])
    elif cmd == "capture":
        cap = call(
            "POST",
            f"/v2/checkout/orders/{args[0]}/capture",
            tok,
            {},
            headers={"PayPal-Request-Id": str(uuid.uuid4())},
        )
        capture = cap["purchase_units"][0]["payments"]["captures"][0]
        print(
            "CAPTURE_ID", capture["id"], "status", capture["status"], capture.get("status_details")
        )
    elif cmd == "track":
        show(
            call(
                "POST",
                f"/v2/checkout/orders/{args[0]}/track",
                tok,
                {
                    "capture_id": args[1],
                    "tracking_number": "1Z999AA10123456784",
                    "carrier": "UPS",
                    "notify_payer": False,
                },
            )
        )
    elif cmd == "disputes":
        show(call("GET", "/v1/customer/disputes", tok))
    elif cmd == "dispute":
        show(call("GET", f"/v1/customer/disputes/{args[0]}", tok))
    elif cmd == "evidence":
        payload = {
            "evidences": [
                {
                    "evidence_type": "PROOF_OF_FULFILLMENT",
                    "evidence_info": {
                        "tracking_info": [
                            {"carrier_name": "UPS", "tracking_number": "1Z999AA10123456784"}
                        ]
                    },
                    "notes": "Shipped with UPS; tracking shows delivered.",
                }
            ]
        }
        boundary = uuid.uuid4().hex
        body = (
            f'--{boundary}\r\nContent-Disposition: form-data; name="input"\r\nContent-Type: application/json\r\n\r\n'
            f"{json.dumps(payload)}\r\n--{boundary}--\r\n"
        ).encode()
        show(
            call(
                "POST",
                f"/v1/customer/disputes/{args[0]}/provide-evidence",
                tok,
                headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
                raw=body,
            )
        )


if __name__ == "__main__":
    main(sys.argv[1:] or ["help"])
