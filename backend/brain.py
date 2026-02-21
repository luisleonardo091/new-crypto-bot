import json
import random
import time
from datetime import datetime, timezone

SYMBOL = "BTCUSDT"


def get_mock_price() -> float:
    return round(96000 + random.uniform(-1200, 1200), 2)


def decide_signal(price: float) -> str:
    if price < 95500:
        return "BUY"
    if price > 96500:
        return "SELL"
    return "HOLD"


def main() -> None:
    print("Starting Python brain. Press Ctrl+C to stop.")
    while True:
        price = get_mock_price()
        signal = decide_signal(price)
        payload = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "symbol": SYMBOL,
            "price": price,
            "signal": signal,
        }
        print(json.dumps(payload))
        time.sleep(2)


if __name__ == "__main__":
    main()
