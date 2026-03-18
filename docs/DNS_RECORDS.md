# DNS Records for Email Deliverability (ziarem.com)

To ensure automated emails from **ken@ziarem.com** land in the inbox and not spam, configure the following DNS records at your domain registrar or DNS provider.

---

## 1. SPF (Sender Policy Framework)

Authorizes which servers can send mail for `ziarem.com`. Add a **TXT** record at the **root** of the domain (`ziarem.com` or `@`).

**If you send via Google Workspace / Gmail SMTP:**

```
Type: TXT
Name: @  (or ziarem.com, depending on provider)
Value: v=spf1 include:_spf.google.com ~all
TTL: 3600
```

**If you use another SMTP provider**, replace the include with their SPF value, for example:

- **Resend:** `v=spf1 include:resend.com ~all`
- **SendGrid:** `v=spf1 include:sendgrid.net ~all`
- **Custom mail server:** `v=spf1 ip4:YOUR_SERVER_IP ~all`

Use **`~all`** (soft fail) or **`-all`** (hard fail). Avoid **`+all`**.

---

## 2. DKIM (DomainKeys Identified Mail)

DKIM signs outgoing messages so receivers can verify they came from your domain. Your **SMTP provider** (Google, Resend, etc.) will give you a **DKIM TXT** record.

**Format (placeholder — replace with value from your provider):**

```
Type: TXT
Name: [selector]._domainkey   (e.g. resend._domainkey or google._domainkey)
Value: [long string provided by your email/SMTP provider]
TTL: 3600
```

**Steps:**

1. In your email/SMTP provider (Google Admin, Resend, SendGrid, etc.), add the domain `ziarem.com` and request DKIM setup.
2. Copy the **host/subdomain** (e.g. `resend._domainkey`) and the **TXT value**.
3. Create a TXT record with that name and value.

---

## 3. DMARC (Domain-based Message Authentication)

Tells receiving servers what to do with messages that fail SPF/DKIM (quarantine or reject) and where to send aggregate reports.

**Recommended starting policy (quarantine):**

```
Type: TXT
Name: _dmarc
Value: v=DMARC1; p=quarantine; rua=mailto:ken@ziarem.com; pct=100; adkim=r; aspf=r; fo=1
TTL: 3600
```

- **`p=quarantine`** — Failures go to spam/junk. After confirming deliverability, you can move to **`p=reject`**.
- **`rua=mailto:ken@ziarem.com`** — Aggregate reports (optional; change to your preferred address).
- **`pct=100`** — Apply policy to 100% of mail.
- **`adkim=r`** / **`aspf=r`** — Relaxed alignment (recommended at first).

**Strict policy (after testing):**

```
v=DMARC1; p=reject; rua=mailto:dmarc-reports@ziarem.com; pct=100; adkim=s; aspf=s
```

---

## Checklist

| Record | Type | Name / Host        | Purpose                    |
|--------|------|--------------------|----------------------------|
| SPF    | TXT  | `@` or `ziarem.com` | Authorize sending servers  |
| DKIM   | TXT  | `[selector]._domainkey` | Sign outbound mail (from provider) |
| DMARC  | TXT  | `_dmarc`            | Policy for failed auth     |

After saving, wait for DNS propagation (up to 48 hours, often minutes). Use [MXToolbox](https://mxtoolbox.com/SuperTool.aspx) or your provider’s DNS check to verify SPF, DKIM, and DMARC.
