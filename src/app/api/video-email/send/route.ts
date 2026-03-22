import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

// Resend for email delivery (already in VAULT deps)
// Falls back to Nodemailer SMTP if RESEND_API_KEY not set
async function sendEmail(to: string, subject: string, html: string, from: string) {
  const resendKey = process.env.RESEND_API_KEY;

  if (resendKey) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to,
        subject,
        html,
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Resend error: ${err}`);
    }
    return await res.json();
  }

  // Fallback: use SMTP env vars
  const nodemailer = await import("nodemailer");
  const transporter = nodemailer.default.createTransport({
    host: process.env.SMTP_HOST || "smtp.hostinger.com",
    port: 587,
    secure: false,
    auth: {
      user: process.env.SMTP_USER || "info@dosmortgage.com",
      pass: process.env.SMTP_PASS || "",
    },
  });

  return transporter.sendMail({ from, to, subject, html });
}

export async function POST(req: NextRequest) {
  try {
    const { videoEmailId } = await req.json();

    if (!videoEmailId) {
      return NextResponse.json({ error: "videoEmailId required" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    // Fetch the video email record
    const { data: ve, error: fetchErr } = await supabase
      .from("video_emails")
      .select("*")
      .eq("id", videoEmailId)
      .single();

    if (fetchErr || !ve) {
      return NextResponse.json({ error: "Video email not found" }, { status: 404 });
    }

    // Build the watch URL
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "https://ziarem.com";
    const watchUrl = `${appUrl}/v/${ve.id}`;

    // Build HTML email with fake video player (like the screenshot)
    const greeting = ve.recipient_name ? `Hi ${ve.recipient_name},` : "Hi,";
    const messageBlock = ve.message
      ? `<p style="color:#333;font-size:15px;line-height:1.6;margin:0 0 20px;">${ve.message.replace(/\n/g, "<br>")}</p>`
      : "";

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:30px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
          <!-- Header -->
          <tr>
            <td style="padding:24px 30px 0;">
              <p style="color:#333;font-size:15px;line-height:1.6;margin:0 0 8px;">${greeting}</p>
              <p style="color:#333;font-size:15px;line-height:1.6;margin:0 0 16px;">${ve.sender_name} sent you a video message.</p>
              ${messageBlock}
            </td>
          </tr>
          <!-- Video Thumbnail -->
          <tr>
            <td style="padding:0 30px;">
              <a href="${watchUrl}" target="_blank" style="display:block;text-decoration:none;position:relative;">
                <img src="${ve.thumbnail_url}" alt="Click to play video" width="540" height="405" style="display:block;width:100%;max-width:540px;height:auto;border-radius:8px;border:0;" />
              </a>
            </td>
          </tr>
          <!-- CTA -->
          <tr>
            <td style="padding:20px 30px;" align="center">
              <a href="${watchUrl}" target="_blank" style="display:inline-block;background:#dc2626;color:#ffffff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">
                &#9654; Watch Video (${ve.video_duration_secs}s)
              </a>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:16px 30px 24px;border-top:1px solid #eee;">
              <p style="color:#999;font-size:12px;margin:0;text-align:center;">
                Sent via <a href="https://ziarem.com" style="color:#dc2626;text-decoration:none;">Ziarem</a> by ${ve.sender_name}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
  <!-- Tracking pixel -->
  <img src="${appUrl}/api/video-email/track?id=${ve.id}&type=open" width="1" height="1" alt="" style="display:none;" />
</body>
</html>`;

    // Send the email
    const fromAddr = ve.sender_email.includes("<")
      ? ve.sender_email
      : `${ve.sender_name} <${ve.sender_email}>`;

    await sendEmail(ve.recipient_email, ve.subject, html, fromAddr);

    // Update sent_at
    await supabase
      .from("video_emails")
      .update({ sent_at: new Date().toISOString() })
      .eq("id", ve.id);

    return NextResponse.json({ success: true, watchUrl });
  } catch (err: any) {
    console.error("video-email/send error:", err);
    return NextResponse.json({ error: err.message || "Send failed" }, { status: 500 });
  }
}
