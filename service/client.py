"""Small fictional Japanese storefront client for a dependency repair demo."""
from urllib.parse import quote, urlsplit

import requests


def yen_total(items):
    """Sum integer-yen prices without floating point currency rounding."""
    total = 0
    for item in items:
        price, quantity = item["price_yen"], item["quantity"]
        if type(price) is not int or type(quantity) is not int or price < 0 or quantity < 0:
            raise ValueError("Prices and quantities must be nonnegative integers")
        total += price * quantity
    return {"currency": "JPY", "total_yen": total}


class SakuraClient:
    def __init__(self, base_url="https://sakura.example.test", session=None):
        parsed = urlsplit(base_url)
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError("An HTTPS service URL without credentials is required")
        self.base_url = base_url.rstrip("/")
        self.session = session if session is not None else requests.Session()
        self.session.trust_env = False
        self.timeout = (3.05, 10)

    def catalog(self, prefecture="東京都"):
        response = self.session.get(
            self.base_url + "/catalog", params={"prefecture": prefecture},
            headers={"Accept": "application/json"}, timeout=self.timeout, verify=True,
        )
        response.raise_for_status()
        return response.json()

    def order(self, order_id, token):
        if not isinstance(token, str) or not token or "\n" in token or "\r" in token:
            raise ValueError("A valid review-only demo token is required")
        response = self.session.get(
            self.base_url + "/orders/" + quote(str(order_id), safe=""),
            headers={"Accept": "application/json", "Authorization": "Bearer " + token},
            timeout=self.timeout, verify=True,
        )
        response.raise_for_status()
        return response.json()


if __name__ == "__main__":
    print("Sakura demo client: tests use fake responses; no production endpoint is contacted.")
