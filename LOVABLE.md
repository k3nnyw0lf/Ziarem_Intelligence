# Connect Lovable to this repo

**Repo:** https://github.com/k3nnyw0lf/Ziarem_Intelligence

1. Go to [lovable.dev](https://lovable.dev) → sign in.
2. In your project: **Settings** or **Integrations** → **Connect to GitHub**.
3. Choose repo: **k3nnyw0lf/Ziarem_Intelligence**, branch **main**.

Then paste the block below into Lovable chat to build the Ziarem Inbox:

---

Build the 'Ziarem Inbox' module. Layout: 3-Pane design (Folders | Email List | Reading Pane).

Feature 1: The 'All-In-One' Feed
- The Email List should show emails from ALL my businesses (Lyco, Wolf, Dispute) mixed together, sorted by date.
- Show a small 'Badge' next to the subject line indicating which business received it (e.g. [Lyco] vs [Wolf]).

Feature 2: The Video Composer
- Add a 'Compose' button.
- Inside the editor, add an 'Insert Video' button.
- Input: 'Paste YouTube URL'.
- Preview: Show the thumbnail with a Play button overlay immediately in the editor.

Feature 3: The Client Context
- When I click an email, the Right Pane should show the message, but ALSO show a 'History' tab with all previous emails/calls for that specific client.

API base URL: point the app at the Ziarem backend (e.g. GET /communications, POST /communications/send-video). See LOVABLE_ZIAREM_INBOX_SPEC.md for endpoints.
