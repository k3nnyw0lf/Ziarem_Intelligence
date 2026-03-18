# Free API integrations (lead enrichment)

Ziarem connects to these **free** (or free-tier) APIs to enrich leads. All are optional; missing keys simply skip that provider.

## Summary

| Integration        | Provider        | Purpose              | Key required? | Free limit        |
|--------------------|-----------------|----------------------|---------------|--------------------|
| **Geocoding**      | Nominatim (OSM) | Address → lat/lon    | No            | 1 request/second  |
| **Email validation** | Abstract API  | Deliverability, format | Yes        | 100/month         |
| **Phone validation** | Abstract / NumVerify | Valid, carrier, country | Yes   | 100 or 250/month |
| **IP geolocation** | ip-api.com      | IP → country, city, ISP | No       | 45/minute        |

## Endpoints

- **GET /integrations** – List which integrations are enabled (no secrets).
- **GET /leads/:id/enrich** – Enrich one lead by `autoId_ui`; returns `{ geocode, email, phone, ip, errors? }`.
  - **?save=1** – Persist results: update `lat`/`lon` from geocode and store `enrichment_result` JSONB (email, phone, ip, geocode display_name).
- **POST /leads/enrich-batch** – Body: `{ leadIds: number[], save?: boolean }`. Enrich up to 10 leads; if `save` is true, persist like `?save=1`. Rate-limited (~1s per lead for geocode).
- **POST /leads/upload?enrich=N** – After upload, optionally enrich the first N inserted leads (max 5) and save; response includes `enriched` count.

Query params for `/leads/:id/enrich`: `skip_geocode=1`, `skip_email=1`, `skip_phone=1`, `skip_ip=1` to skip specific lookups.

## 1. Geocoding – Nominatim (OpenStreetMap)

- **No API key.** Use as-is.
- **Policy:** [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/) – 1 request per second, identify with User-Agent.
- Used when a lead has address (address_1, city, state, zip_code) but no lat/lon. Fills `geocode: { lat, lon, display_name }`.

## 2. Email validation – Abstract API

- **Sign up:** [Abstract API – Email Verification](https://www.abstractapi.com/email-verification-validation-api)
- **Env:** `ABSTRACT_EMAIL_API_KEY=your_key`
- **Free:** 100 requests/month.
- Returns format validity, deliverability, quality score, disposable/role flags.

## 3. Phone validation – Abstract API or NumVerify

- **Abstract:** [Phone Validation API](https://www.abstractapi.com/phone-validation-api) – set `ABSTRACT_PHONE_API_KEY`. 100 free/month.
- **NumVerify:** [NumVerify](https://numverify.com) – set `NUMVERIFY_API_KEY`. 250 free/month.
- If both are set, Abstract is used first. Returns valid, country, carrier, type/location.

## 4. IP geolocation – ip-api.com

- **No API key.** Use as-is.
- **Limit:** 45 requests per minute (free, non-commercial).
- **Docs:** [ip-api.com](http://ip-api.com/docs)
- Used when lead has `ip_addr`. Returns country, region, city, lat/lon, ISP.

## Environment variables (.env)

```env
# Optional – leave empty to skip
ABSTRACT_EMAIL_API_KEY=
ABSTRACT_PHONE_API_KEY=
NUMVERIFY_API_KEY=
```

Geocoding and IP geo work with no keys.

## Rate limits

- When enriching many leads in a row, the code adds a 1.1s delay after geocoding to respect Nominatim’s 1 req/sec rule.
- Email/phone providers enforce their own limits; stay within free tier to avoid errors.
