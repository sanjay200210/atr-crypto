import express from "express";
import axios from "axios";
import cors from "cors";

const app = express();
app.use(cors());

const ACTIVE_INSTRUMENTS =
  "https://api.coindcx.com/exchange/v1/derivatives/futures/data/active_instruments?margin_currency_short_name[]=USDT";

const CANDLES_URL = "https://public.coindcx.com/market_data/candlesticks";

const ATR_PERIOD = 14;

function calculateATR(data) {
  if (data.length < ATR_PERIOD + 1) return null;

  const TR = [];

  for (let i = 1; i < data.length; i++) {
    const high = data[i].high;
    const low = data[i].low;
    const prevClose = data[i - 1].close;

    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );

    TR.push(tr);
  }

  const atr =
    TR.slice(-ATR_PERIOD).reduce((a, b) => a + b, 0) / ATR_PERIOD;

  return (atr * 100) / data[data.length - 1].close;
}

app.get("/api/top-atr", async (req, res) => {
  try {
    const now = Math.floor(Date.now() / 1000);
    const from = now - 20 * 60;

    const instrumentsRes = await axios.get(ACTIVE_INSTRUMENTS);
    const symbols = instrumentsRes.data;

    const requests = symbols.map(pair =>
      axios
        .get(CANDLES_URL, {
          params: {
            pair,
            from,
            to: now,
            resolution: "1",
            pcode: "f",
          },
        })
        .then(response => {
          const candles = response.data?.data;
          if (!candles || candles.length === 0) return null;

          const atr = calculateATR(candles);
          if (!atr) return null;

          return { pair, atr };
        })
        .catch(() => null) // fail silently, move on
    );

    const results = await Promise.all(requests);

    const top5 = results
      .filter(Boolean)
      .sort((a, b) => b.atr - a.atr)
      .slice(0, 5);

    res.json({
      timestamp: new Date().toISOString(),
      top5,
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});


app.listen(3000, () => {
  console.log("🚀 CoinDCX backend running on port 3000");
});
