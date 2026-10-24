"""Frozen business assertions. Run only against the policy-approved candidate."""
import importlib.metadata
import json
import os
import sys

sys.path.insert(0, "/app")
import requests
from service.client import SakuraClient, yen_total


class FakeResponse:
    def __init__(self, payload, status=200):
        self.payload, self.status = payload, status

    def raise_for_status(self):
        if self.status >= 400:
            raise requests.HTTPError("Fictional service rejected this request")

    def json(self):
        return self.payload


class FakeSession:
    def __init__(self):
        self.calls = []
        self.trust_env = True

    def get(self, url, **kwargs):
        self.calls.append({"url": url, **kwargs})
        if "/catalog" in url:
            return FakeResponse({"currency": "JPY", "items": [{"name": "抹茶セット", "price_yen": 2400}], "prefecture": kwargs["params"]["prefecture"]})
        if kwargs.get("headers", {}).get("Authorization") != "Bearer fictional-review-token":
            return FakeResponse({}, 403)
        return FakeResponse({"id": "注文-001", "currency": "JPY", "total_yen": 4800})


results = []
def check(label, assertion):
    assert assertion, label
    results.append(label)
    print("PASS: " + label, file=sys.stderr)


session = FakeSession()
client = SakuraClient(session=session)
catalog = client.catalog("大阪府")
check("Japanese catalog text survives JSON decoding", catalog["items"][0]["name"] == "抹茶セット")
check("Catalog reports integer JPY prices", catalog["currency"] == "JPY" and type(catalog["items"][0]["price_yen"]) is int)
check("Prefecture is passed as a query parameter", session.calls[-1]["params"] == {"prefecture": "大阪府"})
check("TLS verification remains enabled", session.calls[-1]["verify"] is True)
check("Connect and read timeouts remain bounded", session.calls[-1]["timeout"] == (3.05, 10))
check("Environment credentials and proxies are not implicitly trusted", session.trust_env is False)
check("Integer yen totals retain order semantics", yen_total([{"price_yen": 2400, "quantity": 2}]) == {"currency": "JPY", "total_yen": 4800})
try:
    yen_total([{"price_yen": 2.4, "quantity": 1}])
    raise AssertionError("Fractional yen accepted")
except ValueError:
    check("Fractional-yen input is rejected", True)
order = client.order("注文-001/../other", "fictional-review-token")
check("Order keeps Japanese identifier and JPY total", order["id"] == "注文-001" and order["total_yen"] == 4800)
check("Order identifiers cannot become URL path segments", "%2F..%2F" in session.calls[-1]["url"])
try:
    client.order("注文-001", "wrong-fictional-token")
    raise AssertionError("Unauthorized request succeeded")
except requests.HTTPError:
    check("Unauthorized order responses remain rejected", True)
try:
    SakuraClient("http://sakura.example.test", session=session)
    raise AssertionError("Plaintext endpoint accepted")
except ValueError:
    check("Plaintext service endpoints are rejected", True)

installed = [{"name": name, "version": importlib.metadata.version(name)} for name in ["requests", "certifi", "charset-normalizer", "idna", "urllib3"]]
print(json.dumps({"python_version": sys.version.split()[0], "requests_version": requests.__version__, "expected_version": os.environ.get("EXPECTED_VERSION"), "checks": results, "dependencies": installed}, ensure_ascii=False))
