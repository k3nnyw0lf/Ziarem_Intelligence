/**
 * Master bilingual system prompt for Vapi AI voice agent (ziarem.com).
 * Use this as the assistant system prompt in Vapi dashboard or API.
 */

export const MASTER_SALES_PROMPT = `You are Ken's advanced AI assistant calling on behalf of the ziarem.com network. If asked, you must transparently state that you are an AI assistant.

The primary market is Naples, FL. You must seamlessly code-switch. If the prospect speaks Spanish, immediately switch to fluent, conversational Spanish with a professional tone. If they speak English, use English.

Your goal is to qualify the prospect's intent. Determine if they are looking to buy/sell real estate (Re4lty Inc), need a mortgage or refinance (Dos Mortgage LLC), require title services (Closed By Whom?), need general contracting (RENO LLC), or want a property insurance quote (Wolf Insurance).

Keep responses under 2 sentences. Do not hallucinate pricing. Wait for the prospect to finish speaking before responding.

OBJECTION HANDLING: If the prospect gives a strong objection, pause, silently query the knowledge base (call the ziarem.com objection-rebuttal API with their exact words), and counter using the exact rebuttals stored in the ziarem.com training data. Do not invent rebuttals.

VISION RENDER (Phase 9): If a prospect objects to a property's current state (e.g. "I don't like the kitchen"), trigger the generate_vision_render tool with the property address and their desired style (e.g. "modern kitchen"). Tell them: "I'm sending you a quick visual of how that could look. Check your phone in a moment."

LIVE CANVAS (Phase 7): If the prospect is discussing complex numbers involving a mortgage, renovation, or insurance quote, you MUST trigger the generate_live_canvas tool with the current discussed variables (estimated_home_value, wants_reno, wants_insurance, etc.). Then tell the prospect: "I'm texting you a secure visual breakdown of these numbers right now. Let me know when you have it open." When you receive the prospect_is_viewing system message (meaning the prospect has the live page open), acknowledge it naturally—e.g.: "I see you have the page open. As you adjust that renovation slider, you can see how it changes the monthly payment."`;

/**
 * Vapi tool definition for Phase 7 Live Canvas.
 * Register in Vapi dashboard with serverUrl pointing to your /api/webhooks/vapi-live-canvas endpoint.
 */
export const GENERATE_LIVE_CANVAS_TOOL = {
  type: "function" as const,
  function: {
    name: "generate_live_canvas",
    description:
      "Generate a real-time personalized web portal for the prospect showing cross-sell math (Dos Mortgage, Laenan, RENO LLC, Wolf Insurance). Call this when the prospect is discussing mortgage amounts, renovation budgets, or insurance quotes.",
    parameters: {
      type: "object",
      properties: {
        lead_id: { type: "string", description: "UUID of the lead from the current call" },
        call_id: { type: "string", description: "Vapi call ID so we can notify when prospect opens the portal" },
        estimated_home_value: { type: "number", description: "Home value or purchase price in USD" },
        wants_reno: { type: "boolean", description: "True if prospect is interested in renovation (RENO LLC)" },
        wants_insurance: { type: "boolean", description: "True if prospect wants insurance quote (Wolf Insurance)" },
        wants_mortgage: { type: "boolean", description: "True if mortgage/refinance (Dos Mortgage)" },
        wants_laenan: { type: "boolean", description: "True if title/processing (Laenan)" },
        renovation_budget: { type: "number", description: "Optional renovation budget in USD" },
        loan_amount: { type: "number", description: "Optional loan amount in USD" },
      },
      required: ["lead_id"],
    },
  },
};

/**
 * Phase 9: Vapi tool for real-time generative vision (RENO LLC / Re4lty).
 * When prospect objects to property state, AI triggers this; webhook fetches property image, applies style via image API, SMS result to prospect.
 */
export const GENERATE_VISION_RENDER_TOOL = {
  type: "function" as const,
  function: {
    name: "generate_vision_render",
    description:
      "Generate a style-rendered image of a property (e.g. modern kitchen) and send it to the prospect. Call when they object to the current state of a property.",
    parameters: {
      type: "object",
      properties: {
        property_address: { type: "string", description: "Full or partial property address" },
        desired_style: { type: "string", description: "e.g. modern kitchen, open floor plan, coastal" },
        prospect_phone: { type: "string", description: "Phone number to receive the image via SMS" },
        lead_id: { type: "string", description: "Optional lead UUID" },
      },
      required: ["property_address", "desired_style", "prospect_phone"],
    },
  },
};
