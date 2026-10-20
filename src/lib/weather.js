// Coordinates confirmed from the Naver Map link supplied by the farm owner.
export const farmWeatherLocation = {
  name: "안녕동 10-36",
  address: "경기도 화성시 병점구 안녕동 10-36",
  latitude: 37.2040072,
  longitude: 127.0192951,
};
export function weatherUrl(location) {
  if (
    !Number.isFinite(location.latitude) ||
    !Number.isFinite(location.longitude) ||
    Math.abs(location.latitude) > 90 ||
    Math.abs(location.longitude) > 180
  )
    return null;
  const params = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    current:
      "temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m",
    hourly: "sunshine_duration",
    timezone: "Asia/Seoul",
    wind_speed_unit: "ms",
    forecast_days: "1",
  });
  return `https://api.open-meteo.com/v1/forecast?${params}`;
}
const value = (n, min, max) =>
  typeof n === "number" && Number.isFinite(n) && n >= min && n <= max
    ? n
    : null;
export function parseWeather(data) {
  const current = data?.current;
  if (!current || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(current.time || ""))
    throw new Error("날씨 응답에 기준 시각이 없습니다.");
  if (
    data.current_units?.temperature_2m !== "°C" ||
    data.current_units?.relative_humidity_2m !== "%" ||
    data.current_units?.wind_speed_10m !== "m/s"
  )
    throw new Error("날씨 데이터 단위를 확인할 수 없습니다.");
  const hour = current.time.slice(0, 13) + ":00";
  const index = data.hourly?.time?.indexOf(hour) ?? -1;
  const sunshine =
    index >= 0 && data.hourly_units?.sunshine_duration === "s"
      ? value(data.hourly?.sunshine_duration?.[index], 0, 3600)
      : null;
  return {
    time: current.time,
    temperature: value(current.temperature_2m, -100, 70),
    humidity: value(current.relative_humidity_2m, 0, 100),
    wind: value(current.wind_speed_10m, 0, 150),
    direction: value(current.wind_direction_10m, 0, 360),
    sunshine: sunshine == null ? null : Math.round(sunshine / 60),
    sunshineTime: sunshine == null ? null : hour,
  };
}
export function windDirection(degrees) {
  if (degrees == null) return "";
  return ["북", "북동", "동", "남동", "남", "남서", "서", "북서"][
    Math.round(degrees / 45) % 8
  ];
}
