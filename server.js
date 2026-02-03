import express from "express";
import axios from "axios";
import cors from "cors";
import pLimit from "p-limit";

const app = express();
app.use(cors());

const ACTIVE_INSTRUMENTS =
  "https://api.coindcx.com/exchange/v1/derivatives/futures/data/active_instruments?margin_currency_short_name[]=USDT";

const INSTRUMENT_INFO =
  "https://api.coindcx.com/exchange/v1/derivatives/futures/data/instrument";

const CANDLES_URL =
  "https://public.coindcx.com/market_data/candlesticks";

const ATR_PERIOD = 14;
const limit = pLimit(8); // 👈 concurrency control (sweet spot)

function calculateATR(data) {
  if (data.length < ATR_PERIOD + 1) return null;

  let trSum = 0;

  for (let i = data.length - ATR_PERIOD; i < data.length; i++) {
    const high = data[i].high;
    const low = data[i].low;
    const prevClose = data[i - 1].close;

    trSum += Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
  }

  const atr = trSum / ATR_PERIOD;
  return (atr * 100) / data[data.length - 1].close;
}

app.get("/api/top-atr", async (req, res) => {
  try {
    const now = Math.floor(Date.now() / 1000);
    const from = now - 20 * 60;

    const { data: symbols } = await axios.get(ACTIVE_INSTRUMENTS);

    const tasks = symbols.map(symbol =>
      limit(async () => {
        try {
          // 1️⃣ Instrument info (price_increment)
          const infoRes = await axios.get(INSTRUMENT_INFO, {
            params: {
              pair: symbol,
              margin_currency_short_name: "USDT",
            },
          });

          const priceIncrement =
            parseFloat(infoRes.data?.instrument?.price_increment);

          if (!priceIncrement) return null;

          // 2️⃣ Candles
          const candleRes = await axios.get(CANDLES_URL, {
            params: {
              pair: symbol,
              from,
              to: now,
              resolution: "1D",
              pcode: "f",
            },
          });

          const candles = candleRes.data?.data;
          if (!candles || candles.length < ATR_PERIOD + 1) return null;

          const lastClose = candles[candles.length - 1].close;

          // 3️⃣ Python-style filter
          if ((priceIncrement * 100) / lastClose > 0.1) return null;

          // 4️⃣ ATR %
          const atr = calculateATR(candles);
          if (!atr) return null;

          return [symbol, atr];
        } catch {
          return null;
        }
      })
    );

    const results = await Promise.all(tasks);

    const top5 = results
      .filter(Boolean)
      .sort((a, b) => b[1] - a[1])
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
