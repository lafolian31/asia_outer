import { useEffect, useState } from "react";
import { Thermometer, Droplets, Wind, Sun, RefreshCw } from "lucide-react";
import {
  farmWeatherLocation,
  weatherUrl,
  parseWeather,
  windDirection,
} from "../lib/weather.js";
const refreshMs = 15 * 60 * 1000;
type Weather = ReturnType<typeof parseWeather>;
export function FarmWeather() {
  const [data, setData] = useState<Weather | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const url = weatherUrl(farmWeatherLocation);
  useEffect(() => {
    if (!url) return;
    let active = true;
    let controller: AbortController | null = null;
    let pending = false;
    let lastAttempt = 0;
    const cacheKey = `farm-weather:${url}`;
    async function load() {
      if (!active || document.visibilityState === "hidden" || pending) return;
      pending = true;
      lastAttempt = Date.now();
      setBusy(true);
      const request = new AbortController();
      controller = request;
      const timeout = window.setTimeout(() => request.abort(), 12000);
      try {
        const response = await fetch(url!, { signal: request.signal });
        if (!response.ok) throw new Error("weather request failed");
        const body = await response.json();
        const next = parseWeather(body);
        if (active) {
          setData(next);
          setError("");
        }
        try {
          sessionStorage.setItem(
            cacheKey,
            JSON.stringify({ savedAt: Date.now(), body }),
          );
        } catch {
          /* Optional cache. */
        }
      } catch {
        if (active)
          setError("날씨를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
      } finally {
        clearTimeout(timeout);
        pending = false;
        if (active) setBusy(false);
      }
    }
    let cachedAt = 0;
    try {
      const cached = JSON.parse(sessionStorage.getItem(cacheKey) || "null");
      if (cached) {
        setData(parseWeather(cached.body));
        cachedAt = cached.savedAt;
      }
    } catch {
      /* Ignore corrupt optional cache. */
    }
    if (reload || Date.now() - cachedAt >= refreshMs) void load();
    else lastAttempt = cachedAt;
    const check = () => {
      if (Date.now() - lastAttempt >= refreshMs) void load();
    };
    const timer = window.setInterval(check, 60000);
    document.addEventListener("visibilitychange", check);
    window.addEventListener("online", check);
    return () => {
      active = false;
      controller?.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("online", check);
    };
  }, [url, reload]);
  const format = (
    n: number | null | undefined,
    suffix: string,
    decimals = 0,
  ) => (n == null ? "—" : `${n.toFixed(decimals)}${suffix}`);
  return (
    <aside className="farm-weather" aria-label="안녕동 농장 날씨">
      <div className="weather-title">
        <strong>{farmWeatherLocation.name} 날씨</strong>
        {url && (
          <button
            type="button"
            className="icon-button"
            aria-label="날씨 새로고침"
            disabled={busy}
            onClick={() => setReload((n) => n + 1)}
          >
            <RefreshCw size={15} />
          </button>
        )}
      </div>
      <dl className="weather-values">
        <div>
          <dt>
            <Thermometer size={15} />
            기온
          </dt>
          <dd>{format(data?.temperature, "°C", 1)}</dd>
        </div>
        <div>
          <dt>
            <Droplets size={15} />
            습도
          </dt>
          <dd>{format(data?.humidity, "%")}</dd>
        </div>
        <div>
          <dt>
            <Wind size={15} />
            바람
          </dt>
          <dd>
            {format(data?.wind, "m/s", 1)}
            <small>
              {data?.direction != null
                ? `${windDirection(data.direction)}풍`
                : ""}
            </small>
          </dd>
        </div>
        <div>
          <dt>
            <Sun size={15} />
            일조
          </dt>
          <dd>
            {format(data?.sunshine, "분")}
            <small>
              {data?.sunshineTime
                ? `${data.sunshineTime.slice(11, 16)} 이전 1시간`
                : "지난 1시간"}
            </small>
          </dd>
        </div>
      </dl>
      {!url ? (
        <p className="weather-message">
          정확한 농장 위치 확인 후 날씨를 표시합니다.
        </p>
      ) : (
        <>
          {busy && !data && (
            <p className="weather-message" role="status">
              날씨를 불러오는 중…
            </p>
          )}
          {data && (
            <p className="weather-message">
              {data.time.replace("T", " ")} 기준 · 한국 시각
              {error ? " · 이전 자료" : ""}
              <br />
              현재 기상모델 추정 · 일조는 직전 정시 기준 예보
            </p>
          )}
          {error && (
            <p className="weather-error" role="status">
              {error}
            </p>
          )}
        </>
      )}
      <small className="weather-source">
        <a
          href="https://open-meteo.com/"
          target="_blank"
          rel="noopener noreferrer"
        >
          Open-Meteo
        </a>{" "}
        ·{" "}
        <a
          href="https://creativecommons.org/licenses/by/4.0/"
          target="_blank"
          rel="noopener noreferrer"
        >
          CC BY 4.0
        </a>{" "}
        · 단위 환산
      </small>
    </aside>
  );
}
