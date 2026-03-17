import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://sfelhasepvaoianyuvxe.supabase.co";
const SUPABASE_SERVICE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNmZWxoYXNlcHZhb2lhbnl1dnhlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDY4NjQ0NywiZXhwIjoyMDg2MjYyNDQ3fQ.JLz_S0WG-FHBPV02VUfjkR8UzSZYClk_xH6qijulZTA";
const KEN_ID = "b7a67688-73f1-4f4b-9745-f357e81affa3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function twiml(xml: string) {
  return new Response(xml, {
    headers: { ...corsHeaders, "Content-Type": "text/xml" },
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sb() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
}

function cleanPhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

async function matchContact(
  phone: string,
  client: ReturnType<typeof sb>,
): Promise<{ id: string; full_name: string } | null> {
  const last10 = cleanPhone(phone).slice(-10);
  if (!last10) return null;
  const { data } = await client
    .from("contacts")
    .select("id,full_name")
    .or(`phone.ilike.%${last10}%`)
    .limit(1);
  return data?.[0] ?? null;
}

async function notifyTelegram(
  message: string,
  client: ReturnType<typeof sb>,
): Promise<void> {
  try {
    const { data: cfg } = await client
      .from("vault_telegram_config")
      .select("bot_token,chat_id")
      .eq("user_id", KEN_ID)
      .eq("is_active", true)
      .limit(1)
      .single();
    if (!cfg) return;
    await fetch(
      `https://api.telegram.org/bot${cfg.bot_token}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: cfg.chat_id,
          text: message,
          parse_mode: "HTML",
        }),
      },
    );
  } catch (err) {
    console.error("Telegram notification failed:", err);
  }
}

async function findLineByPhone(
  phone: string,
  type: string,
  client: ReturnType<typeof sb>,
) {
  const last10 = cleanPhone(phone).slice(-10);
  const { data } = await client
    .from("vault_sms_lines")
    .select("*")
    .eq("type", type)
    .eq("status", "active")
    .ilike("phone_number", `%${last10}%`)
    .limit(1);
  return data?.[0] ?? null;
}

// ---------------------------------------------------------------------------
// 1. Twilio Incoming SMS
// ---------------------------------------------------------------------------

async function handleTwilio(req: Request): Promise<Response> {
  const client = sb();
  const formData = await req.formData();
  const from = formData.get("From")?.toString() ?? "";
  const to = formData.get("To")?.toString() ?? "";
  const body = formData.get("Body")?.toString() ?? "";
  const messageSid = formData.get("MessageSid")?.toString() ?? "";
  const numMedia = parseInt(formData.get("NumMedia")?.toString() ?? "0", 10);

  // Collect media URLs
  const mediaUrls: string[] = [];
  for (let i = 0; i < numMedia; i++) {
    const url = formData.get(`MediaUrl${i}`)?.toString();
    if (url) mediaUrls.push(url);
  }

  // Find the line this was sent to
  const line = await findLineByPhone(to, "twilio", client);
  if (!line) {
    console.error(`No twilio line found for number: ${to}`);
    return twiml("<Response></Response>");
  }

  // Match sender against contacts
  const contact = await matchContact(from, client);

  // Save message
  const { error } = await client.from("vault_sms_messages").insert({
    line_id: line.id,
    sms_sid: messageSid,
    direction: "inbound",
    from_number: from,
    to_number: to,
    body,
    media_urls: mediaUrls.length > 0 ? mediaUrls : null,
    status: "received",
    contact_id: contact?.id ?? null,
    contact_name: contact?.full_name ?? null,
    is_read: false,
    timestamp: new Date().toISOString(),
  });

  if (error) {
    console.error("Failed to save twilio message:", error);
  }

  // Telegram notification
  const displayName = contact?.full_name ?? "Unknown";
  await notifyTelegram(
    `\u{1F4F1} SMS from ${displayName} (${from}):\n${body}`,
    client,
  );

  return twiml("<Response></Response>");
}

// ---------------------------------------------------------------------------
// 2. Android Gateway Push
// ---------------------------------------------------------------------------

async function handleAndroidPush(req: Request): Promise<Response> {
  const client = sb();
  const payload = await req.json();
  const { device_id, api_token, messages } = payload;

  if (!device_id || !api_token || !Array.isArray(messages)) {
    return json({ error: "Missing device_id, api_token, or messages" }, 400);
  }

  // Validate device
  const { data: line } = await client
    .from("vault_sms_lines")
    .select("*")
    .eq("device_id", device_id)
    .eq("api_token", api_token)
    .eq("status", "active")
    .limit(1);

  if (!line || line.length === 0) {
    return json({ error: "Invalid device_id or api_token" }, 401);
  }

  const activeLine = line[0];
  let imported = 0;

  const rows = [];
  const inboundMessages: Array<{
    from: string;
    body: string;
    contactName: string | null;
  }> = [];

  for (const msg of messages) {
    const direction =
      msg.type === "outbox" || msg.direction === "outbound"
        ? "outbound"
        : "inbound";
    const contact = await matchContact(
      direction === "inbound" ? msg.from : msg.to,
      client,
    );

    rows.push({
      line_id: activeLine.id,
      direction,
      from_number: msg.from,
      to_number: msg.to,
      body: msg.body ?? "",
      media_urls: msg.media_urls ?? null,
      status: direction === "inbound" ? "received" : "sent",
      contact_id: contact?.id ?? null,
      contact_name: contact?.full_name ?? null,
      is_read: direction === "outbound",
      thread_id: msg.thread_id ?? null,
      timestamp: msg.timestamp
        ? new Date(msg.timestamp).toISOString()
        : new Date().toISOString(),
    });

    if (direction === "inbound") {
      inboundMessages.push({
        from: msg.from,
        body: msg.body ?? "",
        contactName: contact?.full_name ?? null,
      });
    }
  }

  if (rows.length > 0) {
    const { error } = await client.from("vault_sms_messages").insert(rows);
    if (error) {
      console.error("Failed to insert android messages:", error);
      return json({ error: "Database insert failed" }, 500);
    }
    imported = rows.length;
  }

  // Telegram notifications for inbound messages
  for (const m of inboundMessages) {
    const displayName = m.contactName ?? "Unknown";
    await notifyTelegram(
      `\u{1F4F1} SMS from ${displayName} (${m.from}):\n${m.body}`,
      client,
    );
  }

  return json({ success: true, imported });
}

// ---------------------------------------------------------------------------
// 3. Send SMS from VAULT
// ---------------------------------------------------------------------------

async function handleSend(req: Request): Promise<Response> {
  const client = sb();
  const { line_id, to, body, media_url } = await req.json();

  if (!line_id || !to || !body) {
    return json({ error: "Missing line_id, to, or body" }, 400);
  }

  // Look up the line
  const { data: line, error: lineErr } = await client
    .from("vault_sms_lines")
    .select("*")
    .eq("id", line_id)
    .single();

  if (lineErr || !line) {
    return json({ error: "Line not found" }, 404);
  }

  const contact = await matchContact(to, client);

  if (line.type === "twilio") {
    // Fetch Twilio credentials
    const { data: cfg } = await client
      .from("vault_sms_config")
      .select("twilio_account_sid,twilio_auth_token")
      .eq("user_id", line.created_by)
      .eq("is_active", true)
      .limit(1)
      .single();

    if (!cfg) {
      return json({ error: "Twilio config not found" }, 500);
    }

    // Send via Twilio REST API
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${cfg.twilio_account_sid}/Messages.json`;
    const twilioBody = new URLSearchParams({
      From: line.phone_number,
      To: to,
      Body: body,
    });
    if (media_url) {
      twilioBody.set("MediaUrl", media_url);
    }

    const twilioResp = await fetch(twilioUrl, {
      method: "POST",
      headers: {
        Authorization:
          "Basic " + btoa(`${cfg.twilio_account_sid}:${cfg.twilio_auth_token}`),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: twilioBody.toString(),
    });

    const twilioResult = await twilioResp.json();

    if (!twilioResp.ok) {
      console.error("Twilio send failed:", twilioResult);
      return json({ error: "Twilio send failed", detail: twilioResult }, 502);
    }

    // Save outbound message
    const { data: saved, error: saveErr } = await client
      .from("vault_sms_messages")
      .insert({
        line_id: line.id,
        sms_sid: twilioResult.sid,
        direction: "outbound",
        from_number: line.phone_number,
        to_number: to,
        body,
        media_urls: media_url ? [media_url] : null,
        status: "sent",
        contact_id: contact?.id ?? null,
        contact_name: contact?.full_name ?? null,
        is_read: true,
        timestamp: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (saveErr) {
      console.error("Failed to save outbound message:", saveErr);
    }

    return json({ success: true, message_id: saved?.id ?? null });
  }

  if (line.type === "android_gateway") {
    // Save as pending outbound — Android app will poll for it
    const { data: saved, error: saveErr } = await client
      .from("vault_sms_messages")
      .insert({
        line_id: line.id,
        direction: "outbound",
        from_number: line.phone_number,
        to_number: to,
        body,
        media_urls: media_url ? [media_url] : null,
        status: "pending",
        contact_id: contact?.id ?? null,
        contact_name: contact?.full_name ?? null,
        is_read: true,
        timestamp: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (saveErr) {
      console.error("Failed to save android outbound message:", saveErr);
      return json({ error: "Failed to queue message" }, 500);
    }

    return json({ success: true, message_id: saved?.id ?? null });
  }

  return json({ error: `Unsupported line type: ${line.type}` }, 400);
}

// ---------------------------------------------------------------------------
// 4. Android Outbox Poll
// ---------------------------------------------------------------------------

async function handleAndroidOutbox(url: URL): Promise<Response> {
  const client = sb();
  const device_id = url.searchParams.get("device_id");
  const api_token = url.searchParams.get("api_token");

  if (!device_id || !api_token) {
    return json({ error: "Missing device_id or api_token" }, 400);
  }

  // Validate device
  const { data: line } = await client
    .from("vault_sms_lines")
    .select("id")
    .eq("device_id", device_id)
    .eq("api_token", api_token)
    .eq("status", "active")
    .limit(1);

  if (!line || line.length === 0) {
    return json({ error: "Invalid device_id or api_token" }, 401);
  }

  const lineId = line[0].id;

  // Fetch pending outbound messages
  const { data: messages, error } = await client
    .from("vault_sms_messages")
    .select("id, to_number, body, media_urls")
    .eq("line_id", lineId)
    .eq("direction", "outbound")
    .eq("status", "pending")
    .order("timestamp", { ascending: true })
    .limit(50);

  if (error) {
    console.error("Failed to fetch outbox:", error);
    return json({ error: "Failed to fetch outbox" }, 500);
  }

  // Mark them as queued so they aren't fetched again
  if (messages && messages.length > 0) {
    const ids = messages.map((m: { id: string }) => m.id);
    await client
      .from("vault_sms_messages")
      .update({ status: "queued" })
      .in("id", ids);
  }

  return json({
    success: true,
    messages:
      messages?.map((m: { id: string; to_number: string; body: string; media_urls: string[] | null }) => ({
        message_id: m.id,
        to: m.to_number,
        body: m.body,
        media_urls: m.media_urls,
      })) ?? [],
  });
}

// ---------------------------------------------------------------------------
// 5. Android Status Report
// ---------------------------------------------------------------------------

async function handleAndroidStatus(req: Request): Promise<Response> {
  const client = sb();
  const { device_id, api_token, message_id, status } = await req.json();

  if (!device_id || !api_token || !message_id || !status) {
    return json(
      { error: "Missing device_id, api_token, message_id, or status" },
      400,
    );
  }

  // Validate device
  const { data: line } = await client
    .from("vault_sms_lines")
    .select("id")
    .eq("device_id", device_id)
    .eq("api_token", api_token)
    .eq("status", "active")
    .limit(1);

  if (!line || line.length === 0) {
    return json({ error: "Invalid device_id or api_token" }, 401);
  }

  const validStatuses = ["sent", "delivered", "failed"];
  if (!validStatuses.includes(status)) {
    return json({ error: `Invalid status. Must be one of: ${validStatuses.join(", ")}` }, 400);
  }

  const { error } = await client
    .from("vault_sms_messages")
    .update({ status })
    .eq("id", message_id)
    .eq("line_id", line[0].id);

  if (error) {
    console.error("Failed to update message status:", error);
    return json({ error: "Failed to update status" }, 500);
  }

  return json({ success: true });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const source = url.searchParams.get("source");
    const action = url.searchParams.get("action");

    // GET requests
    if (req.method === "GET") {
      if (action === "android_outbox") {
        return await handleAndroidOutbox(url);
      }
      return json({ error: "Unknown GET action" }, 400);
    }

    // POST requests
    if (req.method === "POST") {
      if (source === "twilio") {
        return await handleTwilio(req);
      }
      if (source === "android") {
        return await handleAndroidPush(req);
      }
      if (action === "send") {
        return await handleSend(req);
      }
      if (action === "android_status") {
        return await handleAndroidStatus(req);
      }
      return json({ error: "Unknown source or action" }, 400);
    }

    return json({ error: "Method not allowed" }, 405);
  } catch (err) {
    console.error("Unhandled error:", err);
    return json(
      { error: "Internal server error", detail: String(err) },
      500,
    );
  }
});
