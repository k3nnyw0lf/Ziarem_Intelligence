# Drag-and-drop leads upload – Lovable spec

Copy the block below into Lovable to add the leads upload UI.

---

```
Add a 'Leads upload' area (e.g. in Leads or Settings).

- Drag-and-drop zone: accept Excel (.xlsx, .xls) and CSV files.
- On drop or file select: POST the file to the backend as multipart form field `file` to:
  POST /leads/upload
- Show upload progress (indeterminate or spinner while request is in flight).
- On success: display the JSON response summary, e.g.:
  - totalRows, skippedNoEmail, duplicatesRemoved, imported, tagged, inserted
- On error: show the error message (e.g. "No file uploaded" or server error).
- Optional: show a short note that the backend auto-organizes (normalizes columns, dedupes by email, applies Ziarem tags).
```

---

## API (already implemented)

- **POST /leads/upload**  
  - **Content-Type:** `multipart/form-data`, field name: `file`  
  - **Accepts:** `.xlsx`, `.xls`, `.csv` (max 50 MB)  
  - **Response (200):**
    ```json
    {
      "ok": true,
      "filename": "leads.xlsx",
      "stats": {
        "totalRows": 5000,
        "skippedNoEmail": 12,
        "duplicatesRemoved": 100,
        "imported": 4888,
        "tagged": 1200
      },
      "inserted": 4888
    }
    ```
  - Backend behavior: parse file → normalize (trim, map Cole columns) → dedupe by email (keep first) → apply Ziarem tags → insert into `leads` with `ON CONFLICT (autoId_ui) DO NOTHING`.

Point the frontend at your Ziarem API base URL (e.g. `https://your-api.hostinger.site`).
